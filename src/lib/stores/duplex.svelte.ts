	/**
	 * Duplex voice mode store.
	 *
	 * Manages the hands-free conversation loop:
	 *   VAD detects speech → record segment → transcribe (Whisper) → LLM → TTS → repeat
	 *
	 * During TTS playback the VAD keeps running. If user speaks → TTS is interrupted
	 * and the new speech segment is processed immediately.
	 */

	import { browser } from '$app/environment';
	import { vadService } from '$lib/services/stt/vad-service';
	import { settingsStore } from '$lib/stores/settings.svelte';

	/** Decode browser audio blob (webm/mp4/ogg) and re-encode as 16 kHz mono PCM16 WAV. */
	async function blobToWav(blob: Blob): Promise<Blob> {
		const arrayBuffer = await blob.arrayBuffer();
		const ctx = new AudioContext({ sampleRate: 16000 });
		const decoded = await ctx.decodeAudioData(arrayBuffer);
		await ctx.close();

		// Mix down to mono
		const numFrames = decoded.length;
		const mono = new Float32Array(numFrames);
		for (let c = 0; c < decoded.numberOfChannels; c++) {
			const ch = decoded.getChannelData(c);
			for (let i = 0; i < numFrames; i++) mono[i] += ch[i];
		}
		if (decoded.numberOfChannels > 1) {
			for (let i = 0; i < numFrames; i++) mono[i] /= decoded.numberOfChannels;
		}

		// PCM16 LE samples
		const pcm = new Int16Array(numFrames);
		for (let i = 0; i < numFrames; i++) {
			const s = Math.max(-1, Math.min(1, mono[i]));
			pcm[i] = s < 0 ? s * 32768 : s * 32767;
		}

		// Build WAV header
		const dataLen = pcm.byteLength;
		const wavBuf = new ArrayBuffer(44 + dataLen);
		const v = new DataView(wavBuf);
		const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
		str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true);
		str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
		v.setUint16(20, 1, true);   // PCM
		v.setUint16(22, 1, true);   // mono
		v.setUint32(24, 16000, true); // sampleRate
		v.setUint32(28, 32000, true); // byteRate
		v.setUint16(32, 2, true);   // blockAlign
		v.setUint16(34, 16, true);  // bitsPerSample
		str(36, 'data'); v.setUint32(40, dataLen, true);
		new Int16Array(wavBuf, 44).set(pcm);

		return new Blob([wavBuf], { type: 'audio/wav' });
	}

	export type DuplexPhase =
		| 'idle'
		| 'listening'
		| 'recording'
		| 'transcribing'
		| 'thinking'
		| 'speaking';

	// ── Reactive state ──────────────────────────────────────────────────────────
	let isDuplexActive = $state(false);
	let duplexPhase = $state<DuplexPhase>('idle');
	let duplexAudioLevel = $state(0);
	let noiseDetected = $state(false);
	let sensitivity = $state(5); // 1-10 scale. 1 = ignore most noise, 10 = detect very quiet speech.

	// ── Callbacks set on startDuplex() ──────────────────────────────────────────
	let onTranscript: ((text: string) => void) | null = null;
	let onInterrupt: (() => void) | null = null;
	let isProcessing: (() => boolean) | null = null;

	// ── Internal state ───────────────────────────────────────────────────────────
	/** True while TTS audio is playing (so we know when to interrupt). */
	let ttsActive = false;

	/** Text of the TTS sentence currently being spoken. Used to discard echo
	 *  (the microphone hearing the assistant's own voice) during duplex mode. */
	let currentTtsText = '';

	/** Auto-dismiss the noise toast after 2s */
	let noiseToastTimer: ReturnType<typeof setTimeout> | null = null;

	/** Watchdog: if stuck in thinking/transcribing, auto-return to listening. */
	let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
	const WATCHDOG_MS = 30_000;

	// ── Helpers ──────────────────────────────────────────────────────────────────
	function setPhase(p: DuplexPhase) {
		duplexPhase = p;
	}

	function triggerNoiseToast() {
		noiseDetected = true;
		if (noiseToastTimer) clearTimeout(noiseToastTimer);
		noiseToastTimer = setTimeout(() => {
			noiseDetected = false;
			noiseToastTimer = null;
		}, 2000);
	}

	function armWatchdog() {
		clearWatchdog();
		watchdogTimer = setTimeout(() => {
			if (isDuplexActive && (duplexPhase === 'thinking' || duplexPhase === 'transcribing')) {
				console.warn('[Duplex] Watchdog triggered – returning to listening');
				setPhase('listening');
			}
		}, WATCHDOG_MS);
	}

	function clearWatchdog() {
		if (watchdogTimer !== null) {
			clearTimeout(watchdogTimer);
			watchdogTimer = null;
		}
	}

	/** Simple case-insensitive overlap check to detect the microphone picking up
	 *  the assistant's own TTS. Returns true if a is mostly contained in b or vice versa. */
	function isSimilarText(a: string, b: string): boolean {
		if (!a || !b) return false;
		const normalizedA = a.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
		const normalizedB = b.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
		if (!normalizedA || !normalizedB) return false;
		if (normalizedA === normalizedB) return true;
		if (normalizedA.length < 10 || normalizedB.length < 10) {
			return normalizedA === normalizedB;
		}
		const shorter = normalizedA.length < normalizedB.length ? normalizedA : normalizedB;
		const longer = normalizedA.length < normalizedB.length ? normalizedB : normalizedA;
		return longer.includes(shorter) || shorter.includes(longer);
	}

	async function transcribeSegment(blob: Blob, mimeType: string) {
		setPhase('transcribing');
		armWatchdog();

		const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'm4a';

		// Resolve active STT provider (mirrors stt.svelte.ts priority logic)
		const sttConfigProvider = settingsStore.getProviderConfig('stt-config').activeProvider as string | undefined;
		const groqKey = settingsStore.getProviderConfig('groq-stt').apiKey;
		const whisperConfig = settingsStore.getProviderConfig('whisper-local');

		let activeProvider: 'whisper-local' | 'groq-stt';
		if (sttConfigProvider === 'whisper-local') {
			activeProvider = 'whisper-local';
		} else if (sttConfigProvider === 'groq-stt' && groqKey) {
			activeProvider = 'groq-stt';
		} else if (groqKey) {
			// Legacy auto-detect
			activeProvider = 'groq-stt';
		} else {
			activeProvider = 'whisper-local';
		}

		try {
			let text: string | undefined;

			if (activeProvider === 'groq-stt' && groqKey) {
				// Direct Groq API call (browser can reach it)
				const groqBaseUrl = (settingsStore.getProviderConfig('groq-stt').baseUrl as string | undefined)?.replace(/\/$/, '') ?? 'https://api.groq.com/openai/v1';
				const formData = new FormData();
				formData.append('file', blob, `duplex.${ext}`);
				formData.append('model', 'whisper-large-v3-turbo');
				formData.append('response_format', 'json');

				const res = await fetch(`${groqBaseUrl}/audio/transcriptions`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${groqKey}` },
					body: formData
				});
				clearWatchdog();
				if (!res.ok) {
					console.error('[Duplex] Groq STT error', res.status, await res.text());
					setPhase('listening');
					return;
				}
				const data = (await res.json()) as { text?: string };
				text = data.text?.trim();
			} else {
				// Whisper-local via server proxy
				const baseUrl = ((whisperConfig.baseUrl as string | undefined)?.trim() || 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
				const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'wav';
				const formData = new FormData();
				formData.append('file', blob, `duplex.${ext}`);
				formData.append('model', (whisperConfig as { model?: string }).model || 'deepdml/faster-whisper-large-v3-turbo-ct2');
				formData.append('baseUrl', baseUrl);

				const res = await fetch('/api/stt', { method: 'POST', body: formData });
				clearWatchdog();
				if (!res.ok) {
					console.error('[Duplex] Whisper STT error', res.status);
					setPhase('listening');
					return;
				}
				const data = (await res.json()) as { text?: string };
				text = data.text?.trim();
			}

			if (!text) {
				// Whisper transcribed silence / noise → show toast
				triggerNoiseToast();
				setPhase('listening');
				return;
			}

			// Confirmed real speech — interrupt TTS or ongoing LLM generation now.
			// (Not earlier, so background noise that produces no transcription
			// never stops the assistant.)
			const wasTtsActive = ttsActive;
			if (ttsActive) {
				onInterrupt?.();
				ttsActive = false;
			} else if (isProcessing?.()) {
				onInterrupt?.();
			}

			// Echo suppression: if this segment was captured while the assistant was
			// speaking and the transcription matches what was just said, it's the
			// microphone hearing the TTS — discard it instead of looping it back.
			if (wasTtsActive && currentTtsText && isSimilarText(text, currentTtsText)) {
				console.debug('[Duplex] Discarded suspected TTS echo:', text);
				triggerNoiseToast();
				setPhase('listening');
				return;
			}

			setPhase('thinking');
			armWatchdog();
			onTranscript?.(text);
			// +page.svelte will call duplexStore.onTTSStarted() when TTS begins,
			// or duplexStore.onTTSDone() if there is no TTS.
		} catch (err) {
			clearWatchdog();
			console.error('[Duplex] Transcription failed:', err);
			setPhase('listening');
		}
	}

	// ── Public API ───────────────────────────────────────────────────────────────

	export async function startDuplex(callbacks: {
		onTranscript: (text: string) => void;
		onInterrupt: () => void;
		isProcessing?: () => boolean;
	}): Promise<boolean> {
		if (!browser) return false;
		if (isDuplexActive) return true;

		onTranscript = callbacks.onTranscript;
		onInterrupt = callbacks.onInterrupt;
		isProcessing = callbacks.isProcessing || null;
		ttsActive = false;

		const started = await vadService.start(
			{
				onPhaseChange: (phase) => {
					if (phase === 'listening') setPhase('listening');
					else if (phase === 'recording') setPhase('recording');
				},
				onAudioLevel: (level) => {
					duplexAudioLevel = level;
				},
				onSpeechStart: () => {
					// We no longer interrupt TTS on speech onset — background noise
					// would constantly stop the assistant. Instead we wait until
					// transcription confirms real text (see transcribeSegment).
				},
				onSegmentReady: (blob, mimeType) => {
					console.debug(`[Duplex] Segment ready: ${blob.size} bytes, phase=${duplexPhase}, active=${isDuplexActive}`);
					if (!isDuplexActive) return;
					// Skip only if a transcription is already in flight to avoid
					// concurrent whisper requests which cause intermittent 500 errors.
					// During 'thinking' (LLM generating), we still transcribe — real speech
					// will trigger an interrupt via transcribeSegment().
					if (duplexPhase === 'transcribing') return;
					transcribeSegment(blob, mimeType);
				},
				onNoiseDetected: () => {
					triggerNoiseToast();
				},
				onError: (msg) => {
					console.error('[Duplex] VAD error:', msg);
					stopDuplex();
				}
			},
			{
				speechThreshold: (() => {
					const cfg = settingsStore.getProviderConfig('whisper-local');
					return typeof cfg.vadThreshold === 'number' ? cfg.vadThreshold : 0.02;
				})(),
				silenceDurationMs: 2500,
				minSpeechDurationMs: 500,
				preBufferMs: 300
			}
		);

		if (started) {
			isDuplexActive = true;
			// Apply any previously stored sensitivity
			vadService.setSensitivity(sensitivity);
			setPhase('listening');
		}
		return started;
	}

	export function adjustSensitivity(delta: number) {
		sensitivity = Math.max(1, Math.min(10, sensitivity + delta));
		vadService.setSensitivity(sensitivity);
	}

	export function stopDuplex() {
		clearWatchdog();
		isDuplexActive = false;
		ttsActive = false;
		onTranscript = null;
		onInterrupt = null;
		isProcessing = null;
		vadService.stop();
		setPhase('idle');
		duplexAudioLevel = 0;
	}

	/** Called by +page.svelte just before TTS playback starts. */
	export function onTTSStarted() {
		if (!isDuplexActive) return;
		clearWatchdog();
		ttsActive = true;
		setPhase('speaking');
	}

	/** Called by +page.svelte whenever a new TTS sentence starts playing. */
	export function setTtsText(text: string) {
		if (!isDuplexActive) return;
		currentTtsText = text;
	}

	/** Called by +page.svelte when TTS finishes (or when there is no TTS). */
	export function onTTSDone() {
		if (!isDuplexActive) return;
		clearWatchdog();
		ttsActive = false;
		currentTtsText = '';
		// VAD is already running — just switch phase back to listening.
		setPhase('listening');
	}

	// ── Store export ─────────────────────────────────────────────────────────────
	export const duplexStore = {
		get isDuplexActive() { return isDuplexActive; },
		get duplexPhase() { return duplexPhase; },
		get duplexAudioLevel() { return duplexAudioLevel; },
		get noiseDetected() { return noiseDetected; },
		get sensitivity() { return sensitivity; },
		startDuplex,
		stopDuplex,
		onTTSStarted,
		setTtsText,
		onTTSDone,
		adjustSensitivity
	};

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
	let sensitivity = $state(1.0); // 1.0 = default; lower = more sensitive

	// ── Callbacks set on startDuplex() ──────────────────────────────────────────
	let onTranscript: ((text: string) => void) | null = null;
	let onInterrupt: (() => void) | null = null;

	// ── Internal state ───────────────────────────────────────────────────────────
	/** True while TTS audio is playing (so we know when to interrupt). */
	let ttsActive = false;

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
				const formData = new FormData();
				formData.append('file', blob, `duplex.${ext}`);
				formData.append('model', (whisperConfig as { model?: string }).model || 'Systran/faster-whisper-large-v3');
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
	}): Promise<boolean> {
		if (!browser) return false;
		if (isDuplexActive) return true;

		onTranscript = callbacks.onTranscript;
		onInterrupt = callbacks.onInterrupt;
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
					// Interrupt TTS + LLM if it is playing/thinking
					if (ttsActive || duplexPhase === 'thinking') {
						onInterrupt?.();
						ttsActive = false;
					}
				},
				onSegmentReady: (blob, mimeType) => {
					console.debug(`[Duplex] Segment ready: ${blob.size} bytes, phase=${duplexPhase}, active=${isDuplexActive}`);
					if (!isDuplexActive || duplexPhase === 'thinking') return;
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
					return typeof cfg.vadThreshold === 'number' ? cfg.vadThreshold : 0.015;
				})(),
				silenceDurationMs: 1000,
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
		sensitivity = Math.max(0.3, Math.min(4.0, sensitivity + delta));
		vadService.setSensitivity(sensitivity);
	}

	export function stopDuplex() {
		clearWatchdog();
		isDuplexActive = false;
		ttsActive = false;
		onTranscript = null;
		onInterrupt = null;
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

	/** Called by +page.svelte when TTS finishes (or when there is no TTS). */
	export function onTTSDone() {
		if (!isDuplexActive) return;
		clearWatchdog();
		ttsActive = false;
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
		onTTSDone,
		adjustSensitivity
	};

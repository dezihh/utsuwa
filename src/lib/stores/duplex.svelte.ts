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

	// ── Callbacks set on startDuplex() ──────────────────────────────────────────
	let onTranscript: ((text: string) => void) | null = null;
	let onInterrupt: (() => void) | null = null;

	// ── Internal state ───────────────────────────────────────────────────────────
	/** True while TTS audio is playing (so we know when to interrupt). */
	let ttsActive = false;

	/** Watchdog: if stuck in thinking/transcribing, auto-return to listening. */
	let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
	const WATCHDOG_MS = 30_000;

	// ── Helpers ──────────────────────────────────────────────────────────────────
	function setPhase(p: DuplexPhase) {
		duplexPhase = p;
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

		const config = settingsStore.getProviderConfig('whisper-local');
		const baseUrl = (config.baseUrl as string | undefined) || 'http://localhost:8000/v1';
		const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'm4a';

		const formData = new FormData();
		formData.append('file', blob, `duplex.${ext}`);
		formData.append('model', 'Systran/faster-whisper-large-v3');
		formData.append('baseUrl', baseUrl);

		try {
			const res = await fetch('/api/stt', { method: 'POST', body: formData });
			clearWatchdog();

			if (!res.ok) {
				console.error('[Duplex] STT error', res.status);
				setPhase('listening');
				return;
			}

			const data = (await res.json()) as { text?: string };
			const text = data.text?.trim();

			if (!text) {
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
					// Interrupt TTS if it is playing
					if (ttsActive) {
						onInterrupt?.();
						ttsActive = false;
						// VAD will continue and produce a segment naturally
					}
				},
				onSegmentReady: (blob, mimeType) => {
					// Only transcribe if we're in an appropriate phase.
					// During 'thinking' the LLM is still running — discard to avoid overlap.
					if (!isDuplexActive || duplexPhase === 'thinking') return;
					transcribeSegment(blob, mimeType);
				},
				onError: (msg) => {
					console.error('[Duplex] VAD error:', msg);
					stopDuplex();
				}
			},
			{
				speechThreshold: 0.025,
				silenceDurationMs: 1500,
				minSpeechDurationMs: 400,
				preBufferMs: 300
			}
		);

		if (started) {
			isDuplexActive = true;
			setPhase('listening');
		}
		return started;
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
		get isDuplexActive() {
			return isDuplexActive;
		},
		get duplexPhase() {
			return duplexPhase;
		},
		get duplexAudioLevel() {
			return duplexAudioLevel;
		},
		startDuplex,
		stopDuplex,
		onTTSStarted,
		onTTSDone
	};

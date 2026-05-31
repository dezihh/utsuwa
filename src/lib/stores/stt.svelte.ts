import { browser } from '$app/environment';
import { webSpeechService } from '$lib/services/stt/web-speech';
import { groqSttService } from '$lib/services/stt/groq-stt';
import { whisperLocalSttService } from '$lib/services/stt/whisper-local-stt';
import { isTauri } from '$lib/services/platform/platform';
import { settingsStore } from '$lib/stores/settings.svelte';
import { STT_PROVIDERS } from '$lib/services/providers/registry';

export type STTProvider = 'web-speech' | 'groq-stt' | 'whisper-local';

function createSttStore() {
	let isListening = $state(false);
	let isTranscribing = $state(false);
	let transcript = $state('');
	let interimTranscript = $state('');
	let error = $state<string | null>(null);
	let audioLevel = $state(0);
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Resolve the active STT provider. Priority:
	 * 1. Explicitly selected in stt-config.activeProvider
	 * 2. Auto-detect: Groq if key present, else Web Speech
	 */
	const activeProvider = $derived.by<STTProvider>(() => {
		if (!browser) return 'web-speech';
		const explicit = settingsStore.getProviderConfig('stt-config').activeProvider as STTProvider | undefined;
		if (explicit && STT_PROVIDERS.some((p) => p.id === explicit)) return explicit;
		// Legacy auto-detect
		if (settingsStore.getProviderConfig('groq-stt').apiKey) return 'groq-stt';
		return 'web-speech';
	});

	async function startListening(onComplete: (text: string) => void) {
		if (!browser) return;
		if (isListening || isTranscribing) return;

		error = null;
		transcript = '';
		interimTranscript = '';
		audioLevel = 0.2;

		const provider = activeProvider;

		if (provider === 'whisper-local') {
			const config = settingsStore.getProviderConfig('whisper-local');
			whisperLocalSttService.configure({
				baseUrl: config.baseUrl?.trim() || 'http://127.0.0.1:8000/v1'
			});

			const started = await whisperLocalSttService.startListening({
				onResult: (text, isFinal) => {
					if (isFinal) {
						transcript = transcript ? transcript + ' ' + text : text;
						interimTranscript = '';
					} else {
						interimTranscript = text;
					}
				},
				onEnd: () => {
					isListening = false;
					isTranscribing = false;
					audioLevel = 0;
					const finalText = transcript.trim();
					transcript = '';
					interimTranscript = '';
					if (finalText) onComplete(finalText);
				},
				onError: (err) => {
					console.error('[STT Store] Whisper error:', err);
					setError(err);
					isListening = false;
					isTranscribing = false;
					transcript = '';
					interimTranscript = '';
					audioLevel = 0;
				},
				onAudioLevel: (level) => {
					audioLevel = level;
				}
			});

			if (started) isListening = true;

		} else if (provider === 'groq-stt') {
			const config = settingsStore.getProviderConfig('groq-stt');
			if (config.apiKey) {
				groqSttService.setApiKey(config.apiKey);
			}

			const started = await groqSttService.startListening({
				onResult: (text, isFinal) => {
					if (isFinal) {
						transcript = transcript ? transcript + ' ' + text : text;
						interimTranscript = '';
					} else {
						interimTranscript = text;
					}
				},
				onEnd: () => {
					isListening = false;
					isTranscribing = false;
					audioLevel = 0;
					const finalText = transcript.trim();
					transcript = '';
					interimTranscript = '';
					if (finalText) onComplete(finalText);
				},
				onError: (err) => {
					console.error('[STT Store] Groq error:', err);
					setError(err);
					isListening = false;
					isTranscribing = false;
					transcript = '';
					interimTranscript = '';
					audioLevel = 0;
				},
				onAudioLevel: (level) => {
					audioLevel = level;
				}
			});

			if (started) isListening = true;

		} else {
			// web-speech
			const started = webSpeechService.startListening({
				onResult: (text, isFinal) => {
					if (isFinal) {
						transcript = transcript ? transcript + ' ' + text : text;
						interimTranscript = '';
						audioLevel = 0.3;
					} else {
						interimTranscript = text;
						audioLevel = 0.5 + Math.random() * 0.5;
					}
				},
				onEnd: () => {
					isListening = false;
					audioLevel = 0;
					const finalText = transcript.trim();
					transcript = '';
					interimTranscript = '';
					if (finalText) onComplete(finalText);
				},
				onError: (err) => {
					console.error('[STT Store] Web Speech error:', err);
					setError(err);
					isListening = false;
					transcript = '';
					interimTranscript = '';
					audioLevel = 0;
				}
			});

			if (started) isListening = true;
		}
	}

	function stopListening() {
		const provider = activeProvider;
		if (provider === 'whisper-local') {
			isTranscribing = true;
			whisperLocalSttService.stopListening();
		} else if (provider === 'groq-stt') {
			isTranscribing = true;
			groqSttService.stopListening();
		} else {
			webSpeechService.stopListening();
		}
	}

	function cancel() {
		const provider = activeProvider;
		if (provider === 'whisper-local') {
			whisperLocalSttService.abort();
		} else if (provider === 'groq-stt') {
			groqSttService.abort();
		} else {
			webSpeechService.abort();
		}
		isListening = false;
		isTranscribing = false;
		transcript = '';
		interimTranscript = '';
		audioLevel = 0;
	}

	function isSupported() {
		if (!browser) return false;
		const provider = activeProvider;
		if (provider === 'whisper-local') return whisperLocalSttService.isSupported();
		if (provider === 'groq-stt') return groqSttService.isSupported() && !!settingsStore.getProviderConfig('groq-stt').apiKey;
		if (!isTauri() && webSpeechService.isSupported()) return true;
		return false;
	}

	function showUnsupportedError() {
		const provider = activeProvider;
		if (provider === 'groq-stt' && !settingsStore.getProviderConfig('groq-stt').apiKey) {
			setError('Add your Groq API key in Settings → Persona for voice input.');
		} else if (isTauri()) {
			setError('Voice input requires Groq or Local Whisper. Configure in Settings → Persona.');
		} else {
			setError('Voice input not available. Select a provider in Settings → Persona.');
		}
	}

	function setError(message: string) {
		if (errorTimeout) clearTimeout(errorTimeout);
		error = message;
		errorTimeout = setTimeout(() => {
			error = null;
			errorTimeout = null;
		}, 4000);
	}

	function clearError() {
		if (errorTimeout) {
			clearTimeout(errorTimeout);
			errorTimeout = null;
		}
		error = null;
	}

	return {
		get isListening() { return isListening; },
		get isTranscribing() { return isTranscribing; },
		get transcript() { return transcript; },
		get interimTranscript() { return interimTranscript; },
		get displayTranscript() {
			if (transcript && interimTranscript) return transcript + ' ' + interimTranscript;
			return transcript || interimTranscript;
		},
		get error() { return error; },
		get audioLevel() { return audioLevel; },
		get activeProvider() { return activeProvider; },
		startListening,
		stopListening,
		cancel,
		isSupported,
		showUnsupportedError,
		clearError
	};
}

export const sttStore = createSttStore();

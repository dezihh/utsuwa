import { getTTSProvider, type TTSOptions } from '$lib/services/tts';
import { getTTSProvider as getTTSMetadata } from '$lib/services/providers/registry';
import { VoiceOrchestrator, type SpeechSegment } from '$lib/services/voice-orchestrator';
import { vrmStore } from '$lib/stores/vrm.svelte';
import { expressionController } from '$lib/services/vrm/expression-controller';

interface QueueItem {
	text: string;
	onStart?: (text: string) => void;
}

function createTTSStore() {
	let isSpeaking = $state(false);
	let currentAnalyser = $state<AnalyserNode | null>(null);
	let currentSource = $state<AudioBufferSourceNode | null>(null);
	let queue = $state<QueueItem[]>([]);
	const orchestrator = new VoiceOrchestrator();

	function buildOrchestratorCallbacks(
		extraCallbacks?: { onSentenceStart?: (sentence: string, index: number) => void }
	) {
		return {
			onSegmentStart: extraCallbacks?.onSentenceStart
				? (segment: SpeechSegment, index: number) => extraCallbacks.onSentenceStart!(segment.text, index)
				: undefined,
			onAnalyserUpdate: (analyser: AnalyserNode) => {
				currentAnalyser = analyser;
			},
			onEmotionChange: (emotion: string | null) => {
				vrmStore.setEmotion(emotion);
				expressionController.setEmotion(emotion);
			},
			onAction: (action: string) => {
				vrmStore.triggerAction(action);
			},
			onComplete: () => {
				isSpeaking = false;
				currentAnalyser = null;
				currentSource = null;
				vrmStore.setEmotion(null);
				expressionController.setEmotion(null);
			}
		};
	}

	async function speak(text: string, options: TTSOptions) {
		const provider = getTTSMetadata(options.provider);

		// Only providers that require API keys should be blocked here.
		if (provider?.requiresApiKey && !options.apiKey) {
			console.warn('TTS not configured - missing API key');
			return;
		}

		const tts = getTTSProvider(options);
		if (tts.capabilities?.streaming && tts.speakStreaming) {
			isSpeaking = true;
			const segments: SpeechSegment[] = [{ text }];
			await orchestrator.speakSegments(segments, options, buildOrchestratorCallbacks());
			return;
		}

		queue = [...queue, { text }];

		if (isSpeaking) return;

		await processQueue(options);
	}

	/**
	 * Enqueues multiple sentences and fires onSentenceStart exactly when
	 * each sentence's audio begins playing, enabling synchronized speech bubbles.
	 */
	async function speakSentences(
		sentences: SpeechSegment[],
		options: TTSOptions,
		callbacks?: { onSentenceStart?: (sentence: string, index: number) => void }
	) {
		const provider = getTTSMetadata(options.provider);

		if (provider?.requiresApiKey && !options.apiKey) {
			console.warn('TTS not configured - missing API key');
			return;
		}

		const tts = getTTSProvider(options);
		if (!tts.capabilities?.streaming && !tts.speak) {
			console.warn('TTS provider has no playback capability');
			return;
		}

		isSpeaking = true;
		await orchestrator.speakSegments(sentences, options, buildOrchestratorCallbacks(callbacks));
	}

	async function processQueue(options: TTSOptions) {
		if (queue.length === 0) {
			isSpeaking = false;
			currentAnalyser = null;
			return;
		}

		isSpeaking = true;
		const item = queue[0];
		queue = queue.slice(1);

		try {
			const tts = getTTSProvider(options);
			const { source, analyser } = await tts.speak(item.text);

			// Audio has started — fire the callback so bubble/animation sync to this sentence
			item.onStart?.(item.text);

			currentSource = source;
			currentAnalyser = analyser;

			// Wait for playback to complete
			await new Promise<void>((resolve) => {
				source.onended = () => resolve();
			});
		} catch (error) {
			console.error('TTS error:', error);
		}

		// Process next in queue
		await processQueue(options);
	}

	function stop() {
		orchestrator.interrupt();
		expressionController.reset();
		vrmStore.setEmotion(null);

		if (currentSource) {
			try {
				currentSource.stop();
			} catch {
				// Already stopped
			}
		}
		queue = [];
		isSpeaking = false;
		currentAnalyser = null;
		currentSource = null;
	}

	function getAnalyserData(): Uint8Array | null {
		const orchAnalyser = orchestrator.getAnalyser();
		const activeAnalyser = orchAnalyser || currentAnalyser;

		if (!activeAnalyser) return null;

		const dataArray = new Uint8Array(activeAnalyser.frequencyBinCount);
		activeAnalyser.getByteFrequencyData(dataArray);
		return dataArray;
	}

	return {
		get isSpeaking() {
			return isSpeaking;
		},
		get currentAnalyser() {
			return orchestrator.getAnalyser() || currentAnalyser;
		},
		speak,
		speakSentences,
		stop,
		getAnalyserData
	};
}

export const ttsStore = createTTSStore();

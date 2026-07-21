import { type TTSOptions } from '$lib/services/tts';
import { VoiceOrchestrator } from '$lib/services/voice-orchestrator';
import { splitIntoSentences } from '$lib/utils/sentences';
import {
	parsePseudoToolCalls,
	compile,
	compileFromText,
	type CompiledSegment
} from '$lib/services/tts/speech-compiler';
import { normalizeLanguageTags } from '$lib/services/tts/language-tag-normalizer';
import { SpeechScheduler } from '$lib/services/tts/speech-scheduler';
import {
	canSpeak,
	clearQueue,
	enqueue,
	runQueue,
	type QueueEngine,
	type QueueItem
} from './tts-store-logic';

function createTTSStore() {
	let isSpeaking = $state(false);
	let currentAnalyser = $state<AnalyserNode | null>(null);
	let queue = $state<QueueItem[]>([]);
	let lastError = $state<string | null>(null);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;

	const orchestrator = new VoiceOrchestrator();

	function reportError(error: unknown) {
		lastError = error instanceof Error ? error.message : 'Voice playback failed';
		if (errorTimer) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (lastError = null), 8000);
	}

	function buildCompiledSegments(text: string, options: TTSOptions): CompiledSegment[] {
		const primaryLang = options.language || 'de';

		if (options.provider === 'omnivoice') {
			// First try real tool-call syntax emitted by the model.
			const parsed = parsePseudoToolCalls(text);
			console.log('[OmniVoice] parsed pseudo calls:', parsed.calls.length, parsed.calls);
			if (parsed.calls.length > 0) {
				// If the model also wrote plain prose around the calls, treat that
				// prose as primary-language speak() segments so nothing is lost.
				const mixedCalls = parsed.chunks.flatMap((chunk) => {
					if (chunk.type === 'call' && chunk.call) {
						return [chunk.call];
					}
					if (chunk.type === 'prose' && chunk.text) {
						return splitIntoSentences(chunk.text).map((sentence) => ({
							name: 'speak' as const,
							arguments: { text: sentence, lang: primaryLang }
						}));
					}
					return [];
				});
				const segments = compile(mixedCalls, primaryLang).segments;
				console.log('[OmniVoice] compiled segments:', segments);
				return segments;
			}

			// Fallback: normalize inline language/gesture markers (e.g. <speak:es>,
			// [lang:es], <gesture:smile>) into speak()/gesture() calls.
			const normalized = normalizeLanguageTags(text, primaryLang);
			console.log('[OmniVoice] normalized language tags:', normalized.calls);
			if (normalized.calls.length > 0) {
				const segments = compile(normalized.calls, primaryLang).segments;
				console.log('[OmniVoice] compiled segments:', segments);
				return segments;
			}

			// Final fallback: treat the whole text as one primary-language segment.
			console.log('[OmniVoice] falling back to single text segment');
			return compileFromText(text, primaryLang).segments;
		}

		const sentences = splitIntoSentences(text);
		return sentences.map((sentence) => ({ type: 'speak' as const, text: sentence, language: primaryLang }));
	}

	const engine: QueueEngine = {
		get snapshot() {
			return { isSpeaking, queue };
		},
		set snapshot(value) {
			isSpeaking = value.isSpeaking;
			queue = value.queue;
		},
		play: async (item) => {
			const segments = buildCompiledSegments(item.text, item.options);

			// Skip non-speech content early (emoji-only, empty, etc.).
			const hasSpeakable = segments.some(
				(s) => s.type === 'speak' && s.text?.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{P}]/gu, '').trim()
			);
			if (!hasSpeakable) {
				return;
			}

			const scheduler = new SpeechScheduler(orchestrator);
			await scheduler.beginPlan(segments, item.options);
		},
		onError: (error) => {
			console.error('TTS error:', error);
			reportError(error);
		},
		onFinished: () => {
			currentAnalyser = null;
		}
	};

	async function speak(text: string, options: TTSOptions) {
		if (!canSpeak(options)) {
			console.warn('TTS not configured - missing API key');
			return;
		}

		const next = enqueue(text, options, { isSpeaking, queue });
		queue = next.queue;
		await processQueue();
	}

	async function processQueue() {
		await runQueue(engine);
	}

	function stop() {
		orchestrator.interrupt();
		const cleared = clearQueue({ isSpeaking, queue });
		isSpeaking = cleared.isSpeaking;
		queue = cleared.queue;
		currentAnalyser = null;
	}

	return {
		get isSpeaking() {
			return isSpeaking;
		},
		get currentAnalyser() {
			return currentAnalyser;
		},
		get lastError() {
			return lastError;
		},
		speak,
		stop
	};
}

export const ttsStore = createTTSStore();

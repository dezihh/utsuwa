import type { TTSProvider } from '$lib/types';

// Common TTS options interface
export interface TTSOptions {
	provider: TTSProvider;
	apiKey?: string;
	voiceId?: string;
	/** Second voice ID, resolved when LLM emits [voice:alt] tag */
	alternativeVoiceId?: string;
	rvcVoiceId?: string;
	baseUrl?: string;
	speed?: number;
	pitch?: number;
	volume?: number;
	/** Emotion exaggeration for providers that support it (0.0-2.0) */
	exaggeration?: number;
	/** ISO 639-1 language code (undefined = auto-detect) */
	language?: string;
	/** Chatterbox CFG weight 0.0-5.0 */
	cfgWeight?: number;
	/** Chatterbox generation temperature 0.05-1.0 */
	temperature?: number;
	/** OmniVoice diffusion steps — 16 (fast) or 32 (quality) */
	omnivoiceNumStep?: number;
	/** Base speed for [voice:alt] segments (falls back to speed when unset) */
	alternativeSpeed?: number;
}

// Result from TTS speak method
export interface TTSSpeakResult {
	source: AudioBufferSourceNode;
	analyser: AnalyserNode;
}

// Streaming types for providers that support chunked audio
export interface StreamOptions {
	/** Emotion style hint for the TTS engine */
	emotion?: string;
	/** Emotion intensity (0.0-1.0) */
	exaggeration?: number;
	/** Language code (ISO 639-1) for multilingual providers */
	language?: string;
	/** Speech speed override (0.5-2.0, 1.0 = normal) */
	speed?: number;
	/** Per-segment voice ID override (overrides provider default for this segment) */
	voiceId?: string;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
}

export interface AudioChunk {
	/** Raw audio data (WAV/PCM chunk) */
	data: ArrayBuffer;
	/** Whether this is the final chunk */
	done: boolean;
}

// Provider capability flags
export interface TTSCapabilities {
	streaming: boolean;
	emotion: boolean;
	multilingual: boolean;
}

// Base TTS provider interface
export interface ITTSProvider {
	speak(text: string): Promise<TTSSpeakResult>;
	getAudioContext(): AudioContext;
	/** Optional streaming speech - only available on providers with capabilities.streaming */
	speakStreaming?(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk>;
	/** Provider capability flags */
	capabilities?: TTSCapabilities;
	/**
	 * Fetch and decode audio to an AudioBuffer WITHOUT starting playback.
	 * Used by VoiceOrchestrator pipeline to pre-synthesise segment N+1
	 * while segment N is still playing, eliminating inter-sentence gaps.
	 */
	fetchAudioBuffer?(text: string, options?: StreamOptions): Promise<AudioBuffer>;
}

// Shared audio context for all providers
let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
	if (!sharedAudioContext) {
		sharedAudioContext = new AudioContext();
	}
	return sharedAudioContext;
}

/**
 * Unlock the AudioContext for iOS/iPadOS Safari.
 * Must be called from a user gesture handler (tap/click).
 * Safe to call multiple times — no-op after first unlock.
 */
export function unlockAudioContext(): void {
	const ctx = getSharedAudioContext();
	// iOS Safari requires src.start(0) to be called SYNCHRONOUSLY within the
	// user-gesture handler. Putting it in a .then() callback breaks the unlock
	// because the synchronous gesture window has already closed by then.
	// Always play the silent buffer first (synchronously), then resume.
	const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
	const src = ctx.createBufferSource();
	src.buffer = buf;
	src.connect(ctx.destination);
	src.start(0);
	src.onended = () => src.disconnect();
	if (ctx.state === 'suspended' || ctx.state === ('interrupted' as AudioContextState)) {
		ctx.resume().catch(() => {});
	}
}

// Provider base URLs
export const TTS_BASE_URLS: Partial<Record<TTSProvider, string>> = {
	elevenlabs: 'https://api.elevenlabs.io/v1/',
	'openai-tts': 'https://api.openai.com/v1/',
	alltalk: 'http://localhost:7851/api/',
	chatterbox: 'http://localhost:8765/',
	omnivoice: 'http://localhost:8766/'
};

// Default voices per provider
export const DEFAULT_VOICES: Partial<Record<TTSProvider, string>> = {
	elevenlabs: 'EXAVITQu4vr4xnSDxMaL', // Bella
	'openai-tts': 'alloy',
	alltalk: '',
	chatterbox: '',
	omnivoice: 'female3'
};

// Import individual providers
import { ElevenLabsTTS } from './elevenlabs';
import { OpenAITTS } from './openai-tts';
import { AllTalkTTS } from './alltalk';
import { ChatterboxTTS } from './chatterbox';
import { OmniVoiceTTS } from './omnivoice';

// Provider factory
let currentProvider: ITTSProvider | null = null;
let currentOptions: TTSOptions | null = null;

export function getTTSProvider(options: TTSOptions): ITTSProvider {
	// Check if we can reuse the current provider
	if (
		currentProvider &&
		currentOptions &&
		currentOptions.provider === options.provider &&
		currentOptions.apiKey === options.apiKey &&
		currentOptions.voiceId === options.voiceId &&
		currentOptions.rvcVoiceId === options.rvcVoiceId &&
		currentOptions.baseUrl === options.baseUrl &&
		currentOptions.speed === options.speed &&
		currentOptions.exaggeration === options.exaggeration &&
		currentOptions.language === options.language &&
		currentOptions.cfgWeight === options.cfgWeight &&
		currentOptions.temperature === options.temperature &&
		currentOptions.omnivoiceNumStep === options.omnivoiceNumStep
	) {
		return currentProvider;
	}

	// Create new provider based on type
	switch (options.provider) {
		case 'elevenlabs':
			currentProvider = new ElevenLabsTTS(options);
			break;

		case 'openai-tts':
			currentProvider = new OpenAITTS(options);
			break;

		case 'alltalk':
			currentProvider = new AllTalkTTS(options);
			break;

		case 'chatterbox':
			currentProvider = new ChatterboxTTS(options);
			break;

		case 'omnivoice':
			currentProvider = new OmniVoiceTTS(options);
			break;

		default:
			// Fallback to OpenAI TTS for unsupported providers
			console.warn(`TTS provider ${options.provider} not implemented, falling back to OpenAI TTS`);
			currentProvider = new OpenAITTS(options);
	}

	currentOptions = { ...options };
	return currentProvider;
}

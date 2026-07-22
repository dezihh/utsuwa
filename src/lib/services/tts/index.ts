import type { TTSProvider } from '$lib/types';

// Common TTS options interface
export interface TTSOptions {
	provider: TTSProvider;
	apiKey?: string;
	voiceId?: string;
	model?: string;
	baseUrl?: string;
	speed?: number;
	pitch?: number;
	volume?: number;
	/** Primary language for multilingual TTS. */
	language?: string;
	/** Alternative language that triggers the alternative voice. */
	altLanguage?: string;
	/** Voice ID used when the alternative language is active. */
	altVoiceId?: string;
	/** Voice design instructions (OmniVoice: e.g. "female, british accent"). */
	instructions?: string;
	/** Voice design instructions for the alternative language. */
	altInstructions?: string;
	/** OmniVoice: diffusion steps (4-64). Higher = better quality, slower. Default 32. */
	numStep?: number;
	/** Whether the alternative voice/language switch is enabled by the user. */
	enableAltLanguage?: boolean;
	/** Alternative voice speed (0.5-2.0). Falls back to `speed` when unset. */
	altSpeed?: number;
	/** Alternative voice quality / diffusion steps. Falls back to `numStep` when unset. */
	altNumStep?: number;
	/** OmniVoice: voice diversity temperature (0-10). 0 = deterministic. Default 5. */
	positionTemperature?: number;
	/** OmniVoice: token sampling temperature (0-2). 0 = greedy. Default 0. */
	classTemperature?: number;
}

// Result from TTS speak method
export interface TTSSpeakResult {
	source: AudioBufferSourceNode;
	analyser: AnalyserNode;
}

// Per-request options that can override session-level TTS options for a single
// segment (e.g. alternative language/voice or emotion-specific tuning).
export interface StreamOptions {
	voiceId?: string;
	language?: string;
	emotion?: string;
	exaggeration?: number;
	cfgWeight?: number;
	temperature?: number;
	speed?: number;
	pitch?: number;
	volume?: number;
	instructions?: string;
	numStep?: number;
	positionTemperature?: number;
	classTemperature?: number;
	signal?: AbortSignal;
}

// Chunk yielded by streaming TTS providers. `done` marks the end of the stream.
export interface AudioChunk {
	data: ArrayBuffer;
	done: boolean;
}

// Capability flags advertised by a TTS provider.
export interface TTSCapabilities {
	streaming?: boolean;
	emotion?: boolean;
	multilingual?: boolean;
	// Maximum number of concurrent synthesis requests; Infinity if unspecified.
	maxConcurrentSynthesis?: number;
	// True if this provider ignores the speed parameter server-side and the
	// orchestrator must apply it via AudioBufferSourceNode.playbackRate.
	clientSideSpeed?: boolean;
}

// Base TTS provider interface
export interface ITTSProvider {
	speak(text: string): Promise<TTSSpeakResult>;
	/** Fetch a full AudioBuffer for non-streaming pipelining. */
	fetchAudioBuffer?(text: string, options?: StreamOptions): Promise<AudioBuffer>;
	/** Optional true streaming: yields audio chunks as they arrive. */
	speakStreaming?(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk>;
	getAudioContext(): AudioContext;
	/** Capability flags used by the orchestrator to choose the right path. */
	capabilities?: TTSCapabilities;
}

// Shared audio context for all providers
let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
	if (!sharedAudioContext) {
		sharedAudioContext = new AudioContext();
	}
	return sharedAudioContext;
}

let audioContextUnlocked = false;

/**
 * Unlock WebAudio on iOS Safari.
 *
 * iOS requires an AudioContext to be resumed from inside a user gesture.
 * We listen for the first touch/click/key event and briefly create + resume a
 * throwaway AudioContext. Once that succeeds, the shared context (and any other
 * AudioContext in the tab) is allowed to play audio.
 */
export function unlockAudioContext(): void {
	if (typeof window === 'undefined' || audioContextUnlocked) return;

	const events = ['touchstart', 'touchend', 'click', 'keydown'] as const;

	function unlock() {
		if (audioContextUnlocked) return;
		try {
			const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (AC) {
				const ctx = new AC();
				void ctx.resume().finally(() => ctx.close());
			}
			// Resume the already-created shared context as well, in case it was
			// created before the user interacted with the page.
			if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
				void sharedAudioContext.resume();
			}
			audioContextUnlocked = true;
		} catch {
			// ignore older browsers without AudioContext
		}
	}

	events.forEach((event) => {
		window.addEventListener(event, unlock, { once: true, passive: true });
	});
}

// Import individual providers
import { ElevenLabsTTS } from './elevenlabs.ts';
import { OpenAITTS } from './openai-tts.ts';

// Provider factory
let currentProvider: ITTSProvider | null = null;
let currentOptionsKey: string | null = null;

/**
 * Build a stable cache key from the options that actually affect provider
 * behaviour. OmniVoice voice design (instructions), alt voice config, and
 * quality params must invalidate the cache when they change.
 */
function buildProviderCacheKey(options: TTSOptions): string {
	return JSON.stringify({
		provider: options.provider,
		apiKey: options.apiKey,
		voiceId: options.voiceId,
		model: options.model,
		baseUrl: options.baseUrl,
		speed: options.speed,
		instructions: options.instructions,
		altVoiceId: options.altVoiceId,
		altInstructions: options.altInstructions,
		altSpeed: options.altSpeed,
		numStep: options.numStep,
		altNumStep: options.altNumStep,
		positionTemperature: options.positionTemperature,
		classTemperature: options.classTemperature
	});
}

export function getTTSProvider(options: TTSOptions): ITTSProvider {
	// Check if we can reuse the current provider
	const key = buildProviderCacheKey(options);
	if (currentProvider && currentOptionsKey === key) {
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

		// Local TTS is OpenAI-compatible, so it reuses the OpenAI client with a
		// localhost base URL. The provider id drives URL/key/error handling.
		case 'local-tts':
			currentProvider = new OpenAITTS(options);
			break;

		// OmniVoice is OpenAI-compatible via tools/omnivoice/omnivoice-proxy.py.
		case 'omnivoice':
			currentProvider = new OpenAITTS(options);
			break;

		default:
			// Fallback to OpenAI TTS for unsupported providers
			console.warn(`TTS provider ${options.provider} not implemented, falling back to OpenAI TTS`);
			currentProvider = new OpenAITTS(options);
	}

	currentOptionsKey = key;
	return currentProvider;
}

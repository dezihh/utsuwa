// Module types
export * from './module';
export * from './tts-emotion';

// Chat types
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
}

// LLM Provider IDs
export type LLMProvider =
	| 'openai'
	| 'anthropic'
	| 'openrouter'
	| 'custom-endpoint';

export type CustomEndpointTemplate =
	| 'ollama'
	| 'lmstudio'
	| 'llamacpp'
	| 'gemini'
	| 'deepseek'
	| 'xai'
	| 'custom';

export interface LLMConfig {
	provider: LLMProvider;
	model: string;
	apiKey?: string;
	baseUrl?: string;
	/** User-defined label for the custom endpoint */
	label?: string;
	/** Selected template for the custom endpoint */
	endpointTemplate?: CustomEndpointTemplate;
	/** Context window size in tokens (1k–128k) */
	contextSize?: number;
	/** Sampling temperature (0 = deterministic, 2 = very creative). OpenAI/Anthropic/OpenRouter compatible. */
	llmTemperature?: number;
	/** Nucleus sampling threshold (0–1). */
	llmTopP?: number;
	/** Maximum tokens to generate. */
	llmMaxTokens?: number;
	/** Presence penalty (-2 to 2). */
	llmPresencePenalty?: number;
	/** Frequency penalty (-2 to 2). */
	llmFrequencyPenalty?: number;
}

// TTS Provider IDs
export type TTSProvider = 'elevenlabs' | 'openai-tts' | 'alltalk' | 'chatterbox' | 'omnivoice';

export interface TTSConfig {
	provider: TTSProvider;
	apiKey?: string;
	voiceId?: string;
	rvcVoiceId?: string;
	language?: string;
	baseUrl?: string;
	// Voice settings
	speed?: number;
	pitch?: number;
	volume?: number;
}

// Provider configuration (stored in settings)
export interface ProviderConfig {
	apiKey?: string;
	baseUrl?: string;
	/** User-defined label for custom endpoints */
	label?: string;
	/** Selected template for the custom-endpoint LLM provider */
	endpointTemplate?: CustomEndpointTemplate;
	modelId?: string;
	voiceId?: string;
	/** Chatterbox: alternative voice ID for multilingual switching */
	alternativeVoiceId?: string;
	rvcVoiceId?: string;
	language?: string;
	speed?: number;
	/** Chatterbox: alternative voice speech speed */
	alternativeSpeed?: number;
	pitch?: number;
	volume?: number;
	/** For meta-configs (e.g. 'stt-config'): the selected provider id */
	activeProvider?: string;
	cachedModels?: Array<{ id: string; name: string }>;
	/** LLM sampling temperature */
	llmTemperature?: number;
	/** LLM nucleus sampling threshold */
	llmTopP?: number;
	/** LLM maximum tokens to generate */
	llmMaxTokens?: number;
	/** LLM presence penalty */
	llmPresencePenalty?: number;
	/** LLM frequency penalty */
	llmFrequencyPenalty?: number;
	modelsFetchedAt?: number;
	/** Whisper-local: model identifier (e.g. 'deepdml/faster-whisper-large-v3-turbo-ct2') */
	model?: string;
	/** VAD sensitivity threshold (0.005 = very sensitive … 0.05 = low). whisper-local only. */
	vadThreshold?: number;
	/** Chatterbox: emotion exaggeration 0.0-2.0 */
	exaggeration?: number;
	/** Chatterbox: CFG weight 0.0-5.0 */
	cfgWeight?: number;
	/** Chatterbox: generation temperature 0.05-1.0 */
	temperature?: number;
	/** OmniVoice: diffusion steps — 16 (fast) or 32 (quality) */
	omnivoiceNumStep?: number;
	// OmniVoice voice profiles
	/** OmniVoice default voice: 'internal' (voice design) or 'clone' (voice sample) */
	omnivoiceDefaultVoiceType?: 'internal' | 'clone';
	/** OmniVoice default internal voice — gender ('male' | 'female') */
	omnivoiceDefaultGender?: string;
	/** OmniVoice default internal voice — age group */
	omnivoiceDefaultAge?: string;
	/** OmniVoice default internal voice — pitch */
	omnivoiceDefaultPitch?: string;
	/** OmniVoice default voice — speech speed (0.25–4.0) */
	omnivoiceDefaultSpeed?: number;
	/** OmniVoice default clone voice — sample name */
	omnivoiceDefaultCloneId?: string;
	/** OmniVoice: enable alternative voice profile */
	omnivoiceAltEnabled?: boolean;
	/** OmniVoice alternative voice: 'internal' or 'clone' */
	omnivoiceAltVoiceType?: 'internal' | 'clone';
	/** OmniVoice alternative internal voice — gender */
	omnivoiceAltGender?: string;
	/** OmniVoice alternative internal voice — age group */
	omnivoiceAltAge?: string;
	/** OmniVoice alternative internal voice — pitch */
	omnivoiceAltPitch?: string;
	/** OmniVoice alternative voice — speech speed */
	omnivoiceAltSpeed?: number;
	/** OmniVoice alternative clone voice — sample name */
	omnivoiceAltCloneId?: string;
	/** OmniVoice: ISO 639-1 code for the alternative language. Only this language triggers the alt voice. */
	omnivoiceAltLanguage?: string;
}

// VRM types
export interface VRMLoadProgress {
	loaded: number;
	total: number;
	percent: number;
}

// Module types
export * from './module';

// Chat types
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
}

// LLM Provider IDs
export type LLMProvider =
	// Cloud
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'deepseek'
	| 'xai'
	| 'openrouter'
	| 'openai-compatible'
	// Local
	| 'ollama'
	| 'lmstudio'
	| 'llamacpp';

export interface LLMConfig {
	provider: LLMProvider;
	model: string;
	apiKey?: string;
	baseUrl?: string;
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
	modelId?: string;
	voiceId?: string;
	rvcVoiceId?: string;
	language?: string;
	speed?: number;
	pitch?: number;
	volume?: number;
	/** For meta-configs (e.g. 'stt-config'): the selected provider id */
	activeProvider?: string;
	cachedModels?: Array<{ id: string; name: string }>;
	modelsFetchedAt?: number;
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
}

// VRM types
export interface VRMLoadProgress {
	loaded: number;
	total: number;
	percent: number;
}

// Module types
export * from './module';

// LLM Provider IDs
export type LLMProvider =
	// Cloud
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'deepseek'
	| 'xai'
	// Local
	| 'ollama'
	| 'lmstudio'
	// User-configured OpenAI-compatible endpoint
	| 'openai-compatible';

// TTS Provider IDs
export type TTSProvider = 'elevenlabs' | 'openai-tts' | 'local-tts' | 'chatterbox-ng';

// Provider configuration (stored in settings)
export interface ProviderConfig {
	apiKey?: string;
	baseUrl?: string;
	modelId?: string;
	voiceId?: string;
	speed?: number;
	pitch?: number;
	volume?: number;
	cachedModels?: Array<{ id: string; name: string }>;
	modelsFetchedAt?: number;
	// Chatterbox-NG specific parameters (only sent when set)
	exaggeration?: number;
	cfgWeight?: number;
	temperature?: number;
}

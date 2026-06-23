// Provider Registry - All LLM and TTS providers

export interface ProviderMetadata {
	id: string;
	name: string;
	description: string;
	category: 'llm' | 'tts' | 'stt';
	icon: string;
	iconColor?: string;
	requiresApiKey: boolean;
	defaultBaseUrl?: string;
	isLocal?: boolean;
	models?: Array<{ id: string; name: string }>;
	voices?: Array<{ id: string; name: string }>;
	/** Quick presets for the custom-endpoint provider */
	endpointTemplates?: Array<{ id: string; name: string; baseUrl: string; docsHint?: string }>;
}

// ============================================
// LLM PROVIDERS (4 total)
// ============================================

export const LLM_PROVIDERS: ProviderMetadata[] = [
	{
		id: 'openai',
		name: 'OpenAI',
		description: 'GPT-4, o1, and more',
		category: 'llm',
		icon: '🤖',
		requiresApiKey: true,
		defaultBaseUrl: 'https://api.openai.com/v1/'
	},
	{
		id: 'anthropic',
		name: 'Anthropic',
		description: 'Claude models',
		category: 'llm',
		icon: '🧠',
		requiresApiKey: true,
		defaultBaseUrl: 'https://api.anthropic.com/v1/'
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		description: 'Access 200+ models from one API',
		category: 'llm',
		icon: '🔀',
		requiresApiKey: true,
		defaultBaseUrl: 'https://openrouter.ai/api/v1/'
	},
	{
		id: 'custom-endpoint',
		name: 'Custom Endpoint',
		description: 'Any OpenAI-compatible endpoint (Ollama, LM Studio, Gemini, self-hosted, ...)',
		category: 'llm',
		icon: '🔌',
		requiresApiKey: false,
		defaultBaseUrl: '',
		endpointTemplates: [
			{
				id: 'custom',
				name: 'Custom (manual URL)',
				baseUrl: '',
				docsHint: 'Enter the base URL of any OpenAI-compatible API.'
			},
			{
				id: 'ollama',
				name: 'Ollama',
				baseUrl: 'http://localhost:11434/v1/',
				docsHint: 'Make sure Ollama is running with "ollama serve" and the model is pulled.'
			},
			{
				id: 'lmstudio',
				name: 'LM Studio',
				baseUrl: 'http://localhost:1234/v1/',
				docsHint: 'Open LM Studio, load a model, and start the developer server.'
			},
			{
				id: 'llamacpp',
				name: 'llama.cpp',
				baseUrl: 'http://localhost:8080/v1/',
				docsHint: 'Start llama-server with "llama-server --model <model.gguf>".'
			},
			{
				id: 'gemini',
				name: 'Google Gemini',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
				docsHint: 'Use an API key from Google AI Studio and enter the model ID manually (e.g. gemini-1.5-flash-latest).'
			},
			{
				id: 'deepseek',
				name: 'DeepSeek',
				baseUrl: 'https://api.deepseek.com/v1/',
				docsHint: 'Use your DeepSeek API key and enter the model ID manually (e.g. deepseek-chat).'
			},
			{
				id: 'xai',
				name: 'xAI (Grok)',
				baseUrl: 'https://api.x.ai/v1/',
				docsHint: 'Use your xAI API key and enter the model ID manually (e.g. grok-2-latest).'
			}
		]
	}
];

// ============================================
// TTS PROVIDERS (4 total)
// ============================================

export const TTS_PROVIDERS: ProviderMetadata[] = [
	// Cloud TTS - models fetched dynamically from API after user enters key
	{
		id: 'elevenlabs',
		name: 'ElevenLabs',
		description: 'High-quality AI voices',
		category: 'tts',
		icon: '🎙️',
		requiresApiKey: true,
		defaultBaseUrl: 'https://api.elevenlabs.io/v1/',
		// models fetched from API
		voices: [
			{ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
			{ id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
			{ id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
			{ id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi' },
			{ id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
			{ id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte' }
		]
	},
	{
		id: 'openai-tts',
		name: 'OpenAI TTS',
		description: 'OpenAI text-to-speech voices',
		category: 'tts',
		icon: '🔊',
		requiresApiKey: true,
		defaultBaseUrl: 'https://api.openai.com/v1/',
		models: [
			{ id: 'tts-1', name: 'TTS-1 (Standard)' },
			{ id: 'tts-1-hd', name: 'TTS-1 HD (High Fidelity)' },
			{ id: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS' }
		],
		voices: [
			{ id: 'alloy', name: 'Alloy' },
			{ id: 'ash', name: 'Ash' },
			{ id: 'coral', name: 'Coral' },
			{ id: 'echo', name: 'Echo' },
			{ id: 'fable', name: 'Fable' },
			{ id: 'onyx', name: 'Onyx' },
			{ id: 'nova', name: 'Nova' },
			{ id: 'sage', name: 'Sage' },
			{ id: 'shimmer', name: 'Shimmer' },
			{ id: 'ballad', name: 'Ballad' },
			{ id: 'verse', name: 'Verse' },
			{ id: 'marin', name: 'Marin' },
			{ id: 'cedar', name: 'Cedar' }
		]
	},
	{
		id: 'alltalk',
		name: 'AllTalk',
		description: 'Local TTS with voices and RVC support',
		category: 'tts',
		icon: '🎧',
		requiresApiKey: false,
		isLocal: true,
		defaultBaseUrl: 'http://localhost:7851/api/',
		voices: []
	},
	{
		id: 'chatterbox',
		name: 'Chatterbox',
		description: 'Local TTS with streaming, emotion control, and multilingual support',
		category: 'tts',
		icon: '🗣️',
		requiresApiKey: false,
		isLocal: true,
		defaultBaseUrl: 'http://localhost:8765/',
		voices: []
	},
	{
		id: 'omnivoice',
		name: 'OmniVoice',
		description: 'Local TTS — RTF ~0.5, 600+ languages, voice cloning (16 or 32 diffusion steps)',
		category: 'tts',
		icon: '🌐',
		requiresApiKey: false,
		isLocal: true,
		defaultBaseUrl: 'http://localhost:8766/',
		voices: [
			{ id: 'lidl', name: 'Lidl (DE, female, formal)' },
			{ id: 'female3', name: 'Female3 / Cosi (DE, female, warm)' }
		]
	},
];

// ============================================
// STT PROVIDERS
// ============================================

export const STT_PROVIDERS: ProviderMetadata[] = [
	{
		id: 'web-speech',
		name: 'Browser (Web Speech)',
		description: 'Free in-browser speech recognition. Works in Chrome/Edge; not available in Tauri.',
		category: 'stt',
		icon: '🌐',
		requiresApiKey: false
	},
	{
		id: 'whisper-local',
		name: 'Local Whisper',
		description: 'Local faster-whisper server (Docker). High quality, no API key required.',
		category: 'stt',
		icon: '🎙️',
		requiresApiKey: false,
		defaultBaseUrl: 'http://localhost:8000/v1'
	},
	{
		id: 'groq-stt',
		name: 'Groq (Cloud)',
		description: "Fast cloud-based speech recognition via Groq's Whisper API.",
		category: 'stt',
		icon: '🎤',
		requiresApiKey: true,
		defaultBaseUrl: 'https://api.groq.com/openai/v1/'
	}
];

// Helper functions
export function getLLMProvider(id: string): ProviderMetadata | undefined {
	return LLM_PROVIDERS.find((p) => p.id === id);
}

export function getTTSProvider(id: string): ProviderMetadata | undefined {
	return TTS_PROVIDERS.find((p) => p.id === id);
}

export function getSTTProvider(id: string): ProviderMetadata | undefined {
	return STT_PROVIDERS.find((p) => p.id === id);
}

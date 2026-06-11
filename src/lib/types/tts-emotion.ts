export type TTSEmotionProvider = 'elevenlabs' | 'openai-tts' | 'alltalk' | 'chatterbox' | 'omnivoice';

export interface TTSProviderEmotionCapabilities {
	supportsSpeed: boolean;
	supportsPitch: boolean;
	supportsVolume: boolean;
	supportsExaggeration: boolean;
	supportsNativeTags: boolean;
	availableNativeTags: string[];
}

export interface TTSEmotionConfig {
	ttsText: string;
	displayText: string;
	speed?: number;
	pitch?: number;
	volume?: number;
	exaggeration?: number;
	nativeTag?: string;
	enabled: boolean;
}

export interface TTSProviderEmotionProfile {
	provider: TTSEmotionProvider;
	emotions: Record<string, TTSEmotionConfig>;
}

export interface TTSBodyActionRule {
	emotionTag: string;
	actionId: string;
	probability: number;
	cooldownMs: number;
	enabled: boolean;
}

export interface TTSEmotionStoreData {
	providerOverrides: Partial<Record<TTSEmotionProvider, Record<string, Partial<TTSEmotionConfig>>>>;
	bodyActionRules: TTSBodyActionRule[];
}

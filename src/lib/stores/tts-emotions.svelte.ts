import { browser } from '$app/environment';
import type {
	TTSEmotionProvider,
	TTSEmotionConfig,
	TTSProviderEmotionCapabilities,
	TTSBodyActionRule,
	TTSEmotionStoreData
} from '$lib/types/tts-emotion';
import { EMOTION_TAGS } from '$lib/utils/sentences';
import { settingsStore } from './settings.svelte';
import { ttsStore } from './tts.svelte';
import type { SpeechSegment } from '$lib/services/voice-orchestrator';

export const PROVIDER_EMOTION_CAPABILITIES: Record<TTSEmotionProvider, TTSProviderEmotionCapabilities> = {
	chatterbox: {
		supportsSpeed: true,
		supportsPitch: true,
		supportsVolume: true,
		supportsExaggeration: true,
		supportsNativeTags: false,
		availableNativeTags: []
	},
	omnivoice: {
		supportsSpeed: true,
		supportsPitch: true,
		supportsVolume: true,
		supportsExaggeration: false,
		supportsNativeTags: true,
		availableNativeTags: ['laughter', 'surprise-oh', 'surprise-ah', 'dissatisfaction-hnn', 'confirmation-en']
	},
	alltalk: {
		supportsSpeed: true,
		supportsPitch: true,
		supportsVolume: true,
		supportsExaggeration: false,
		supportsNativeTags: false,
		availableNativeTags: []
	},
	elevenlabs: {
		supportsSpeed: true,
		supportsPitch: true,
		supportsVolume: true,
		supportsExaggeration: false,
		supportsNativeTags: false,
		availableNativeTags: []
	},
	'openai-tts': {
		supportsSpeed: true,
		supportsPitch: true,
		supportsVolume: true,
		supportsExaggeration: false,
		supportsNativeTags: false,
		availableNativeTags: []
	}
};

const DEFAULT_NATIVE_TAG_MAP: Record<string, string> = {
	laugh: 'laughter',
	surprised: 'surprise-oh',
	shocked: 'surprise-ah',
	annoyed: 'dissatisfaction-hnn',
	calm: 'confirmation-en',
	relaxed: 'confirmation-en'
};

const DEFAULT_BODY_ACTION_RULES: TTSBodyActionRule[] = [
	{ emotionTag: 'laugh', actionId: 'shake', probability: 0.6, cooldownMs: 4000, enabled: true },
	{ emotionTag: 'giggle', actionId: 'shake', probability: 0.5, cooldownMs: 4000, enabled: true },
	{ emotionTag: 'chuckle', actionId: 'shake', probability: 0.4, cooldownMs: 4000, enabled: true },
	{ emotionTag: 'excited', actionId: 'jump', probability: 0.4, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'surprised', actionId: 'jump', probability: 0.5, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'shocked', actionId: 'jump', probability: 0.7, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'gasp', actionId: 'jump', probability: 0.5, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'sad', actionId: 'sad-pose', probability: 0.5, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'sigh', actionId: 'sad-pose', probability: 0.4, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'cry', actionId: 'sad-pose', probability: 0.6, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'lonely', actionId: 'sad-pose', probability: 0.4, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'angry', actionId: 'shake', probability: 0.6, cooldownMs: 4000, enabled: true },
	{ emotionTag: 'frustrated', actionId: 'shake', probability: 0.5, cooldownMs: 4000, enabled: true },
	{ emotionTag: 'annoyed', actionId: 'shake', probability: 0.4, cooldownMs: 4000, enabled: true },
	{ emotionTag: 'happy', actionId: 'wave', probability: 0.3, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'proud', actionId: 'wave', probability: 0.3, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'love', actionId: 'wave', probability: 0.3, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'flirty', actionId: 'wave', probability: 0.3, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'dramatic', actionId: 'lookaround', probability: 0.4, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'confused', actionId: 'think', probability: 0.4, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'unsure', actionId: 'think', probability: 0.3, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'nervous', actionId: 'think', probability: 0.3, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'shy', actionId: 'blush', probability: 0.5, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'calm', actionId: 'relax', probability: 0.3, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'relaxed', actionId: 'relax', probability: 0.3, cooldownMs: 6000, enabled: true },
	{ emotionTag: 'sleepy', actionId: 'sleepy', probability: 0.5, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'yawn', actionId: 'sleepy', probability: 0.5, cooldownMs: 5000, enabled: true },
	{ emotionTag: 'scream', actionId: 'surprised-pose', probability: 0.6, cooldownMs: 4000, enabled: true }
];

const STORAGE_KEY = 'utsuwa-tts-emotions-v1';

function buildDefaultEmotions(): Record<string, TTSEmotionConfig> {
	const out: Record<string, TTSEmotionConfig> = {};
	for (const [tag, entry] of Object.entries(EMOTION_TAGS)) {
		out[tag] = {
			ttsText: entry.ttsText ?? '',
			displayText: entry.displayText ?? '',
			speed: entry.speed,
			pitch: 1,
			volume: 1,
			exaggeration: entry.exaggeration,
			enabled: true
		};
	}
	// Apply default animation mappings from body action rules directly into emotions
	for (const rule of DEFAULT_BODY_ACTION_RULES) {
		const emotion = out[rule.emotionTag];
		if (emotion && rule.enabled) {
			emotion.animationId = rule.actionId;
			emotion.animationProbability = rule.probability;
			emotion.animationCooldownMs = rule.cooldownMs;
		}
	}
	return out;
}

function buildDefaultProviderProfile(provider: TTSEmotionProvider): Record<string, TTSEmotionConfig> {
	const emotions = buildDefaultEmotions();
	if (provider === 'omnivoice') {
		for (const [tag, nativeTag] of Object.entries(DEFAULT_NATIVE_TAG_MAP)) {
			if (emotions[tag]) {
				emotions[tag].nativeTag = nativeTag;
			}
		}
	}
	return emotions;
}

function createTTSEmotionsStore() {
	let providerOverrides = $state<Partial<Record<TTSEmotionProvider, Record<string, Partial<TTSEmotionConfig>>>>>({});
	let bodyActionRules = $state<TTSBodyActionRule[]>([...DEFAULT_BODY_ACTION_RULES]);

	function load() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as TTSEmotionStoreData;
				if (parsed.providerOverrides) providerOverrides = parsed.providerOverrides;
				if (parsed.bodyActionRules) bodyActionRules = parsed.bodyActionRules;
			}
		} catch {
			// ignore
		}
	}

	function save() {
		if (!browser) return;
		try {
			const data: TTSEmotionStoreData = {
				providerOverrides,
				bodyActionRules
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch {
			// ignore
		}
	}

	load();

	function getProviderCapabilities(provider: TTSEmotionProvider): TTSProviderEmotionCapabilities {
		return PROVIDER_EMOTION_CAPABILITIES[provider];
	}

	function getDefaultEmotions(provider: TTSEmotionProvider): Record<string, TTSEmotionConfig> {
		return buildDefaultProviderProfile(provider);
	}

	function getEmotionConfig(provider: TTSEmotionProvider, tag: string | undefined): TTSEmotionConfig | null {
		if (!tag) return null;
		const defaults = buildDefaultProviderProfile(provider);
		const base = defaults[tag];
		if (!base) return null;
		const override = providerOverrides[provider]?.[tag];
		return override ? { ...base, ...override } : { ...base };
	}

	function setEmotionConfig(provider: TTSEmotionProvider, tag: string, patch: Partial<TTSEmotionConfig>) {
		if (!providerOverrides[provider]) {
			providerOverrides[provider] = {};
		}
		providerOverrides[provider]![tag] = {
			...providerOverrides[provider]![tag],
			...patch
		};
		save();
	}

	function resetProviderToDefaults(provider: TTSEmotionProvider) {
		if (providerOverrides[provider]) {
			delete providerOverrides[provider];
			providerOverrides = { ...providerOverrides };
			save();
		}
	}

	function getBodyActionRules(): TTSBodyActionRule[] {
		return bodyActionRules;
	}

	function setBodyActionRules(rules: TTSBodyActionRule[]) {
		bodyActionRules = [...rules];
		save();
	}

	function updateBodyActionRule(index: number, patch: Partial<TTSBodyActionRule>) {
		if (index < 0 || index >= bodyActionRules.length) return;
		bodyActionRules = bodyActionRules.map((r, i) => (i === index ? { ...r, ...patch } : r));
		save();
	}

	async function testEmotion(provider: TTSEmotionProvider, tag: string) {
		const config = getEmotionConfig(provider, tag);
		if (!config) return;

		const providerConfig = settingsStore.getProviderConfig(provider);
		const testText = config.ttsText || `This is a test of the ${tag} emotion.`;

		const options = {
			provider,
			voiceId: providerConfig.voiceId,
			baseUrl: providerConfig.baseUrl,
			apiKey: providerConfig.apiKey,
			speed: config.speed,
			pitch: config.pitch,
			volume: config.volume,
			exaggeration: config.exaggeration,
			language: providerConfig.language,
			rvcVoiceId: providerConfig.rvcVoiceId,
			cfgWeight: providerConfig.cfgWeight,
			temperature: providerConfig.temperature,
			omnivoiceNumStep: providerConfig.omnivoiceNumStep
		};

		const segment: SpeechSegment = {
			text: testText,
			emotion: tag,
			speed: config.speed,
			exaggeration: config.exaggeration
		};

		await ttsStore.speakSentences([segment], options);
	}

	return {
		get providerOverrides() {
			return providerOverrides;
		},
		get bodyActionRules() {
			return bodyActionRules;
		},
		getProviderCapabilities,
		getDefaultEmotions,
		getEmotionConfig,
		setEmotionConfig,
		resetProviderToDefaults,
		getBodyActionRules,
		setBodyActionRules,
		updateBodyActionRule,
		testEmotion
	};
}

export const ttsEmotionsStore = createTTSEmotionsStore();

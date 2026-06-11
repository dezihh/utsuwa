import type { TTSProvider } from '$lib/types';
import { ttsEmotionsStore, PROVIDER_EMOTION_CAPABILITIES } from '$lib/stores/tts-emotions.svelte';
import type { SpeechSegment } from '$lib/services/voice-orchestrator';

export interface AudioEffects {
	speed?: number;
	pitch?: number;
	volume?: number;
}

export function applyEmotionToSegment(
	segment: SpeechSegment,
	provider: TTSProvider
): { segment: SpeechSegment; audioEffects: AudioEffects } {
	if (!segment.emotion) {
		return { segment, audioEffects: {} };
	}

	const config = ttsEmotionsStore.getEmotionConfig(provider, segment.emotion);
	if (!config || !config.enabled) {
		return { segment, audioEffects: {} };
	}

	const caps = PROVIDER_EMOTION_CAPABILITIES[provider];
	const modified: SpeechSegment = { ...segment };

	if (caps.supportsSpeed && config.speed !== undefined) {
		modified.speed = config.speed;
	}
	if (caps.supportsExaggeration && config.exaggeration !== undefined) {
		modified.exaggeration = config.exaggeration;
	}

	if (caps.supportsNativeTags && config.nativeTag) {
		modified.text = `[${config.nativeTag}] ${modified.text}`;
	}

	const audioEffects: AudioEffects = {};
	if (!caps.supportsSpeed && config.speed !== undefined) {
		audioEffects.speed = config.speed;
	}
	if (config.pitch !== undefined) {
		audioEffects.pitch = config.pitch;
	}
	if (config.volume !== undefined) {
		audioEffects.volume = config.volume;
	}

	return { segment: modified, audioEffects };
}

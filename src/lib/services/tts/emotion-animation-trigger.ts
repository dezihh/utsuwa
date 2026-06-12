import { vrmStore } from '$lib/stores/vrm.svelte';
import { ttsEmotionsStore } from '$lib/stores/tts-emotions.svelte';

// Track last trigger time per emotion tag
const lastTriggerTimes = new Map<string, number>();

/**
 * Called when a speech segment with an emotion tag starts playing.
 * Checks if an animation should be triggered based on probability + cooldown.
 */
export function triggerEmotionAnimation(emotionTag: string, provider: string): void {
	const config = ttsEmotionsStore.getEmotionConfig(provider as any, emotionTag);
	if (!config || !config.animationId || config.animationProbability === undefined) return;
	if (config.animationProbability <= 0) return;

	const now = Date.now();
	const lastTime = lastTriggerTimes.get(emotionTag) || 0;
	const cooldown = config.animationCooldownMs || 4000;

	if (now - lastTime < cooldown) return;

	// Probability check
	if (Math.random() > config.animationProbability) return;

	// Trigger animation
	vrmStore.setCurrentAnimation(config.animationId);
	lastTriggerTimes.set(emotionTag, now);
}

export function resetAnimationTriggers(): void {
	lastTriggerTimes.clear();
}

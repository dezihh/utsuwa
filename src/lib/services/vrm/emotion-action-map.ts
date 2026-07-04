/**
 * Emotion-to-Action automatic mapping.
 *
 * When the LLM outputs an emotion tag like [laugh], this system can
 * automatically trigger a matching body animation (e.g. a subtle shoulder
 * shake).  The mapping is configurable per animation and respects:
 *   - probability  (not every tag should animate — avoids mechanical feel)
 *   - cooldown     (prevents spam when multiple tags appear in one response)
 *   - availability (missing or llm-disabled animations are ignored)
 */

import { vrmStore, type AnimationEntry } from '$lib/stores/vrm.svelte';
import { ttsEmotionsStore } from '$lib/stores/tts-emotions.svelte';

export interface EmotionActionRule {
	/** Emotion tag that triggers this action (e.g. 'laugh') */
	emotionTag: string;
	/** Animation ID to trigger (e.g. 'shake') */
	actionId: string;
	/** 0.0–1.0 chance that this mapping fires (default 1.0) */
	probability: number;
	/** Minimum milliseconds between repeated triggers (default 3000) */
	cooldownMs: number;
	/** Whether this rule is active */
	enabled?: boolean;
}

// ── Sensible defaults (subtle, not intrusive) ──────────────────────────────

// Default rules are intentionally empty: the stock animation set only contains
// the VRoid Motion Pack clips (VRMA_01–VRMA_07). Users can add custom VRMA
// animations and configure emotion-to-action mappings in Settings > TTS Emotions.
export const DEFAULT_EMOTION_ACTION_RULES: EmotionActionRule[] = [];

// ── Runtime state (session-only, not persisted) ────────────────────────────

const lastFired = new Map<string, number>();

/** Check whether an animation is currently available (exists + enabled for LLM). */
function isActionAvailable(actionId: string): boolean {
	const all = vrmStore.allAnimations;
	const anim = all.find((a) => a.id === actionId);
	if (!anim) return false;
	if (anim.missing) return false;
	if (anim.llmEnabled === false) return false;
	return true;
}

/**
 * Resolve an emotion tag to an implicit action ID.
 * Returns undefined if no mapping matches, the action is on cooldown,
 * the probability roll fails, or the animation is unavailable.
 */
export function resolveEmotionAction(
	emotionTag: string,
	customRules?: EmotionActionRule[]
): string | undefined {
	const rules = customRules ?? ttsEmotionsStore.getBodyActionRules();
	const tag = emotionTag.toLowerCase();

	const rule = rules.find((r) => r.emotionTag.toLowerCase() === tag && r.enabled !== false);
	if (!rule) return undefined;

	// Availability check
	if (!isActionAvailable(rule.actionId)) return undefined;

	// Cooldown check
	const now = Date.now();
	const last = lastFired.get(rule.actionId) ?? 0;
	if (now - last < rule.cooldownMs) return undefined;

	// Probability roll
	if (Math.random() > rule.probability) return undefined;

	lastFired.set(rule.actionId, now);
	return rule.actionId;
}

/** Manually reset all cooldowns (e.g. on session end). */
export function resetEmotionActionCooldowns(): void {
	lastFired.clear();
}

/** Peek whether a rule exists for an emotion tag (without firing). */
export function hasEmotionActionRule(
	emotionTag: string,
	customRules?: EmotionActionRule[]
): boolean {
	const rules = customRules ?? ttsEmotionsStore.getBodyActionRules();
	return rules.some((r) => r.emotionTag.toLowerCase() === emotionTag.toLowerCase() && r.enabled !== false);
}

/** Get all rules that target a specific action ID. */
export function getRulesForAction(
	actionId: string,
	customRules?: EmotionActionRule[]
): EmotionActionRule[] {
	const rules = customRules ?? ttsEmotionsStore.getBodyActionRules();
	return rules.filter((r) => r.actionId === actionId && r.enabled !== false);
}

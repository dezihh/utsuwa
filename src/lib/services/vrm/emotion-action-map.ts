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

export interface EmotionActionRule {
	/** Emotion tag that triggers this action (e.g. 'laugh') */
	emotionTag: string;
	/** Animation ID to trigger (e.g. 'shake') */
	actionId: string;
	/** 0.0–1.0 chance that this mapping fires (default 1.0) */
	probability: number;
	/** Minimum milliseconds between repeated triggers (default 3000) */
	cooldownMs: number;
}

// ── Sensible defaults (subtle, not intrusive) ──────────────────────────────

export const DEFAULT_EMOTION_ACTION_RULES: EmotionActionRule[] = [
	{ emotionTag: 'laugh',     actionId: 'shake',    probability: 0.6, cooldownMs: 4000 },
	{ emotionTag: 'giggle',    actionId: 'shake',    probability: 0.5, cooldownMs: 4000 },
	{ emotionTag: 'chuckle',   actionId: 'shake',    probability: 0.4, cooldownMs: 4000 },
	{ emotionTag: 'excited',   actionId: 'jump',     probability: 0.4, cooldownMs: 6000 },
	{ emotionTag: 'surprised', actionId: 'jump',     probability: 0.5, cooldownMs: 5000 },
	{ emotionTag: 'shocked',   actionId: 'jump',     probability: 0.7, cooldownMs: 5000 },
	{ emotionTag: 'gasp',      actionId: 'jump',     probability: 0.5, cooldownMs: 5000 },
	{ emotionTag: 'sad',       actionId: 'sad-pose', probability: 0.5, cooldownMs: 5000 },
	{ emotionTag: 'sigh',      actionId: 'sad-pose', probability: 0.4, cooldownMs: 5000 },
	{ emotionTag: 'cry',       actionId: 'sad-pose', probability: 0.6, cooldownMs: 5000 },
	{ emotionTag: 'lonely',    actionId: 'sad-pose', probability: 0.4, cooldownMs: 5000 },
	{ emotionTag: 'angry',     actionId: 'shake',    probability: 0.6, cooldownMs: 4000 },
	{ emotionTag: 'frustrated',actionId: 'shake',    probability: 0.5, cooldownMs: 4000 },
	{ emotionTag: 'annoyed',   actionId: 'shake',    probability: 0.4, cooldownMs: 4000 },
	{ emotionTag: 'happy',     actionId: 'wave',     probability: 0.3, cooldownMs: 6000 },
	{ emotionTag: 'proud',     actionId: 'wave',     probability: 0.3, cooldownMs: 6000 },
	{ emotionTag: 'love',      actionId: 'wave',     probability: 0.3, cooldownMs: 6000 },
	{ emotionTag: 'flirty',    actionId: 'wave',     probability: 0.3, cooldownMs: 6000 },
	{ emotionTag: 'dramatic',  actionId: 'lookaround', probability: 0.4, cooldownMs: 5000 },
	{ emotionTag: 'confused',  actionId: 'think',    probability: 0.4, cooldownMs: 5000 },
	{ emotionTag: 'unsure',    actionId: 'think',    probability: 0.3, cooldownMs: 5000 },
	{ emotionTag: 'nervous',   actionId: 'think',    probability: 0.3, cooldownMs: 5000 },
	{ emotionTag: 'shy',       actionId: 'blush',    probability: 0.5, cooldownMs: 5000 },
	{ emotionTag: 'calm',      actionId: 'relax',    probability: 0.3, cooldownMs: 6000 },
	{ emotionTag: 'relaxed',   actionId: 'relax',    probability: 0.3, cooldownMs: 6000 },
	{ emotionTag: 'sleepy',    actionId: 'sleepy',   probability: 0.5, cooldownMs: 5000 },
	{ emotionTag: 'yawn',      actionId: 'sleepy',   probability: 0.5, cooldownMs: 5000 },
	{ emotionTag: 'scream',    actionId: 'surprised-pose', probability: 0.6, cooldownMs: 4000 }
];

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
	const rules = customRules ?? DEFAULT_EMOTION_ACTION_RULES;
	const tag = emotionTag.toLowerCase();

	const rule = rules.find((r) => r.emotionTag.toLowerCase() === tag);
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
	const rules = customRules ?? DEFAULT_EMOTION_ACTION_RULES;
	return rules.some((r) => r.emotionTag.toLowerCase() === emotionTag.toLowerCase());
}

/** Get all rules that target a specific action ID. */
export function getRulesForAction(
	actionId: string,
	customRules?: EmotionActionRule[]
): EmotionActionRule[] {
	const rules = customRules ?? DEFAULT_EMOTION_ACTION_RULES;
	return rules.filter((r) => r.actionId === actionId);
}

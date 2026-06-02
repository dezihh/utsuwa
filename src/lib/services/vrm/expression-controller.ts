export interface EmotionMapping {
	expression: string;
	intensity: number;
	fadeIn: number;
	fadeOut: number;
}

export const DEFAULT_EMOTION_MAPPINGS: Record<string, EmotionMapping> = {
	laugh: { expression: 'happy', intensity: 0.8, fadeIn: 0.25, fadeOut: 0.8 },
	giggle: { expression: 'happy', intensity: 0.6, fadeIn: 0.3, fadeOut: 0.7 },
	chuckle: { expression: 'happy', intensity: 0.4, fadeIn: 0.35, fadeOut: 0.6 },
	excited: { expression: 'happy', intensity: 0.7, fadeIn: 0.2, fadeOut: 0.5 },
	sad: { expression: 'sad', intensity: 0.6, fadeIn: 0.5, fadeOut: 1.2 },
	sigh: { expression: 'sad', intensity: 0.35, fadeIn: 0.4, fadeOut: 1.0 },
	calm: { expression: 'relaxed', intensity: 0.4, fadeIn: 0.6, fadeOut: 1.0 },
	whisper: { expression: 'relaxed', intensity: 0.2, fadeIn: 0.5, fadeOut: 0.8 },
	dramatic: { expression: 'surprised', intensity: 0.7, fadeIn: 0.15, fadeOut: 0.6 }
};

function cloneMappings(mappings: Record<string, EmotionMapping>): Record<string, EmotionMapping> {
	const out: Record<string, EmotionMapping> = {};
	for (const [emotion, config] of Object.entries(mappings)) {
		out[emotion] = { ...config };
	}
	return out;
}

export class ExpressionController {
	private currentEmotion: string | null = null;
	private targetMapping: EmotionMapping | null = null;
	private currentIntensity = 0;
	private previousExpression: string | null = null;
	private previousIntensity = 0;
	private mappings: Record<string, EmotionMapping> = cloneMappings(DEFAULT_EMOTION_MAPPINGS);
	private managedExpressions: string[] = [];

	setMappings(mappings: Record<string, EmotionMapping> | null): void {
		this.mappings = mappings ? cloneMappings(mappings) : cloneMappings(DEFAULT_EMOTION_MAPPINGS);

		const exprs = new Set<string>();
		for (const config of Object.values(this.mappings)) {
			if (config.expression?.trim()) exprs.add(config.expression);
		}
		// Keep common aliases in the reset set so stale values get cleared.
		for (const fallback of ['happy', 'sad', 'relaxed', 'surprised', 'angry', 'joy', 'sorrow', 'fun']) {
			exprs.add(fallback);
		}
		this.managedExpressions = [...exprs];

		// Re-evaluate active emotion with new mappings.
		if (this.currentEmotion) {
			const next = this.resolveMapping(this.currentEmotion);
			this.targetMapping = next;
		}
	}

	setEmotion(emotion: string | null): void {
		if (emotion === this.currentEmotion) return;

		if (this.targetMapping && this.currentIntensity > 0.01) {
			this.previousExpression = this.targetMapping.expression;
			this.previousIntensity = this.currentIntensity;
		}

		this.currentEmotion = emotion;
		this.targetMapping = emotion ? this.resolveMapping(emotion) : null;
		this.currentIntensity = 0;
	}

	update(delta: number): Map<string, number> {
		const result = new Map<string, number>();
		for (const expr of this.managedExpressions) result.set(expr, 0);

		if (this.previousExpression && this.previousIntensity > 0.01) {
			const fadeRate = delta / (this.targetMapping?.fadeOut ?? 0.8);
			this.previousIntensity = Math.max(0, this.previousIntensity - fadeRate);
			result.set(this.previousExpression, this.previousIntensity);

			if (this.previousIntensity <= 0.01) {
				this.previousExpression = null;
				this.previousIntensity = 0;
			}
		}

		if (this.targetMapping) {
			const fadeRate = delta / this.targetMapping.fadeIn;
			this.currentIntensity = Math.min(
				this.targetMapping.intensity,
				this.currentIntensity + fadeRate
			);
			const existing = result.get(this.targetMapping.expression) ?? 0;
			result.set(this.targetMapping.expression, Math.max(existing, this.currentIntensity));
		} else if (this.currentIntensity > 0.01) {
			const fadeRate = delta / 0.8;
			this.currentIntensity = Math.max(0, this.currentIntensity - fadeRate);
		}

		return result;
	}

	reset(): void {
		this.currentEmotion = null;
		this.targetMapping = null;
		this.currentIntensity = 0;
		this.previousExpression = null;
		this.previousIntensity = 0;
	}

	private resolveMapping(emotion: string): EmotionMapping | null {
		const mapping = this.mappings[emotion];
		if (!mapping) return null;
		const expression = mapping.expression?.trim();
		if (!expression) return null;
		return { ...mapping, expression };
	}
}

export const expressionController = new ExpressionController();

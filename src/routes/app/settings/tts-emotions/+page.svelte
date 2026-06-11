<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import { ttsEmotionsStore } from '$lib/stores/tts-emotions.svelte';
	import type { TTSEmotionProvider, TTSEmotionConfig, TTSBodyActionRule } from '$lib/types/tts-emotion';
	import { EMOTION_TAGS } from '$lib/utils/sentences';
	import { vrmStore } from '$lib/stores/vrm.svelte';

	const providers: TTSEmotionProvider[] = ['chatterbox', 'omnivoice', 'alltalk', 'elevenlabs', 'openai-tts'];
	const providerLabels: Record<TTSEmotionProvider, string> = {
		chatterbox: 'Chatterbox',
		omnivoice: 'OmniVoice',
		alltalk: 'AllTalk',
		elevenlabs: 'ElevenLabs',
		'openai-tts': 'OpenAI TTS'
	};

	let activeProvider = $state<TTSEmotionProvider>('chatterbox');
	let testingTag = $state<string | null>(null);

	const emotionEntries = $derived(
		Object.entries(EMOTION_TAGS).map(([tag, entry]) => ({
			tag,
			displayText: entry.displayText ?? '',
			config: ttsEmotionsStore.getEmotionConfig(activeProvider, tag)
		}))
	);

	const caps = $derived(ttsEmotionsStore.getProviderCapabilities(activeProvider));
	const bodyRules = $derived(ttsEmotionsStore.bodyActionRules);
	const availableActions = $derived(vrmStore.availableAnimations.filter((a) => !a.missing).map((a) => a.id));

	function updateEmotion(tag: string, patch: Partial<TTSEmotionConfig>) {
		ttsEmotionsStore.setEmotionConfig(activeProvider, tag, patch);
	}

	function resetProvider() {
		ttsEmotionsStore.resetProviderToDefaults(activeProvider);
	}

	async function testEmotion(tag: string) {
		testingTag = tag;
		try {
			await ttsEmotionsStore.testEmotion(activeProvider, tag);
		} finally {
			testingTag = null;
		}
	}

	function updateRule(index: number, patch: Partial<TTSBodyActionRule>) {
		ttsEmotionsStore.updateBodyActionRule(index, patch);
	}

	function formatSlider(val: number | undefined, digits = 2) {
		if (val === undefined || !Number.isFinite(val)) return '—';
		return val.toFixed(digits);
	}
</script>

<div class="page">
	<header class="page-header">
		<h2>TTS Emotions</h2>
		<p>Configure how each emotion tag sounds per TTS provider.</p>
	</header>

	<div class="sections">
		<!-- Provider Tabs -->
		<section class="section">
			<h3>Provider</h3>
			<div class="mode-selector">
				{#each providers as provider}
					<button
						class="mode-option"
						class:active={activeProvider === provider}
						onclick={() => (activeProvider = provider)}
					>
						{providerLabels[provider]}
					</button>
				{/each}
			</div>
		</section>

		<!-- Emotion Table -->
		<section class="section">
			<div class="section-header-row">
				<h3>Emotions ({emotionEntries.length})</h3>
				<button class="reset-btn" onclick={resetProvider}>
					<Icon name="refresh-cw" size={14} />
					Reset to Defaults
				</button>
			</div>

			<div class="emotion-list">
				{#each emotionEntries as { tag, displayText, config }}
					{#if config}
						<div class="emotion-row">
							<div class="emotion-main">
								<div class="emotion-name">
									<span class="emotion-emoji">{displayText}</span>
									<span class="emotion-tag">{tag}</span>
								</div>

								<input
									type="text"
									class="emotion-text-input"
									value={config.ttsText}
									onchange={(e) => updateEmotion(tag, { ttsText: e.currentTarget.value })}
									placeholder="Spoken text…"
								/>

								<div class="emotion-toggles">
									<label class="toggle" title="Enabled">
										<input
											type="checkbox"
											checked={config.enabled}
											onchange={(e) => updateEmotion(tag, { enabled: e.currentTarget.checked })}
										/>
										<span class="toggle-track">
											<span class="toggle-thumb"></span>
										</span>
									</label>
									<button
										class="test-btn"
										disabled={testingTag === tag || !config.enabled}
										onclick={() => testEmotion(tag)}
										title="Test"
									>
										{#if testingTag === tag}
											<Icon name="loader" size={14} />
										{:else}
											<Icon name="play" size={14} />
										{/if}
									</button>
								</div>
							</div>

							<div class="emotion-sliders">
								{#if caps.supportsSpeed}
									<div class="slider-group">
										<span class="slider-label">Speed</span>
										<input
											type="range"
											min="0.5"
											max="2.0"
											step="0.05"
											value={config.speed ?? 1}
											oninput={(e) => updateEmotion(tag, { speed: parseFloat(e.currentTarget.value) })}
										/>
										<span class="slider-value">{formatSlider(config.speed ?? 1, 2)}</span>
									</div>
								{/if}

								{#if caps.supportsPitch}
									<div class="slider-group">
										<span class="slider-label">Pitch</span>
										<input
											type="range"
											min="0.5"
											max="2.0"
											step="0.05"
											value={config.pitch ?? 1}
											oninput={(e) => updateEmotion(tag, { pitch: parseFloat(e.currentTarget.value) })}
										/>
										<span class="slider-value">{formatSlider(config.pitch ?? 1, 2)}</span>
									</div>
								{/if}

								{#if caps.supportsVolume}
									<div class="slider-group">
										<span class="slider-label">Volume</span>
										<input
											type="range"
											min="0"
											max="2.0"
											step="0.05"
											value={config.volume ?? 1}
											oninput={(e) => updateEmotion(tag, { volume: parseFloat(e.currentTarget.value) })}
										/>
										<span class="slider-value">{formatSlider(config.volume ?? 1, 2)}</span>
									</div>
								{/if}

								{#if caps.supportsExaggeration}
									<div class="slider-group">
										<span class="slider-label">Exaggeration</span>
										<input
											type="range"
											min="0"
											max="2.0"
											step="0.05"
											value={config.exaggeration ?? 0.5}
											oninput={(e) => updateEmotion(tag, { exaggeration: parseFloat(e.currentTarget.value) })}
										/>
										<span class="slider-value">{formatSlider(config.exaggeration ?? 0.5, 2)}</span>
									</div>
								{/if}

								{#if caps.supportsNativeTags}
									<div class="slider-group native-tag">
										<span class="slider-label">Native Tag</span>
										<select
											value={config.nativeTag ?? ''}
											onchange={(e) => updateEmotion(tag, { nativeTag: e.currentTarget.value || undefined })}
										>
											<option value="">— None —</option>
											{#each caps.availableNativeTags as native}
												<option value={native}>{native}</option>
											{/each}
										</select>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</section>

		<!-- Body-Action Mapping -->
		<section class="section">
			<div class="section-header-row">
				<h3>Body-Action Mapping</h3>
				<span class="hint">Trigger avatar animations when emotions are spoken.</span>
			</div>

			<div class="rules-list">
				{#each bodyRules as rule, i}
					<div class="rule-row">
						<div class="rule-info">
							<span class="rule-tag">{rule.emotionTag}</span>
							<span class="rule-arrow">→</span>
							<select
								value={rule.actionId}
								onchange={(e) => updateRule(i, { actionId: e.currentTarget.value })}
								class="rule-action-select"
							>
								{#each availableActions as action}
									<option value={action}>{action}</option>
								{/each}
							</select>
						</div>

						<div class="rule-sliders">
							<div class="slider-group compact">
								<span class="slider-label">Chance</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={rule.probability}
									oninput={(e) => updateRule(i, { probability: parseFloat(e.currentTarget.value) })}
								/>
								<span class="slider-value">{(rule.probability * 100).toFixed(0)}%</span>
							</div>

							<div class="slider-group compact">
								<span class="slider-label">Cooldown</span>
								<input
									type="range"
									min="0"
									max="10000"
									step="500"
									value={rule.cooldownMs}
									oninput={(e) => updateRule(i, { cooldownMs: parseInt(e.currentTarget.value) })}
								/>
								<span class="slider-value">{(rule.cooldownMs / 1000).toFixed(1)}s</span>
							</div>
						</div>

						<div class="rule-toggle">
							<label class="toggle" title="Enabled">
								<input
									type="checkbox"
									checked={rule.enabled}
									onchange={(e) => updateRule(i, { enabled: e.currentTarget.checked })}
								/>
								<span class="toggle-track">
									<span class="toggle-thumb"></span>
								</span>
							</label>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>

<style>
	.page {
		height: 100%;
		max-width: 720px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.page-header {
		margin-bottom: 1.5rem;
		flex-shrink: 0;
	}

	.page-header h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.page-header p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.875rem;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		padding-bottom: 1rem;
	}

	.section h3 {
		margin: 0 0 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.section-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.section-header-row h3 {
		margin: 0;
	}

	.hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}

	.reset-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.75rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .reset-btn {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.reset-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	/* Mode Selector - Skeuomorphic */
	.mode-selector {
		display: flex;
		background: linear-gradient(180deg, #e8e8e8 0%, #d8d8d8 100%);
		border-radius: 12px;
		padding: 4px;
		gap: 3px;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.08),
			0 1px 0 rgba(255, 255, 255, 0.8);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.mode-selector::-webkit-scrollbar {
		display: none;
	}

	:global(.dark) .mode-selector {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.mode-option {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		background: transparent;
		border: none;
		border-radius: 9px;
		color: var(--text-tertiary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s ease-out;
		white-space: nowrap;
	}

	.mode-option:hover:not(.active) {
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.5);
	}

	:global(.dark) .mode-option:hover:not(.active) {
		background: rgba(255, 255, 255, 0.05);
	}

	.mode-option.active {
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		color: var(--text-primary);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.12),
			0 1px 2px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .mode-option.active {
		background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.3),
			0 1px 2px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	/* Emotion List */
	.emotion-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.emotion-row {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 1rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		transition: transform 0.1s ease-out;
	}

	:global(.dark) .emotion-row {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.emotion-main {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.emotion-name {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 6.5rem;
		flex-shrink: 0;
	}

	.emotion-emoji {
		font-size: 1.125rem;
		line-height: 1;
	}

	.emotion-tag {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		text-transform: capitalize;
	}

	.emotion-text-input {
		flex: 1;
		min-width: 8rem;
		padding: 0.4rem 0.625rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-primary);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.8);
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	:global(.dark) .emotion-text-input {
		background: linear-gradient(180deg, #222 0%, #1a1a1a 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.emotion-text-input:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.05),
			0 0 0 3px rgba(1, 178, 255, 0.15);
	}

	.emotion-toggles {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.test-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border: none;
		border-radius: 8px;
		color: white;
		cursor: pointer;
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
		transition: all 0.15s ease-out;
	}

	.test-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.test-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.emotion-sliders {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem 1rem;
		padding-left: 0;
	}

	.slider-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 10rem;
		flex: 1;
	}

	.slider-group.compact {
		min-width: 8rem;
	}

	.slider-group.native-tag {
		min-width: 8rem;
		flex: 1;
	}

	.slider-group.native-tag select {
		flex: 1;
		padding: 0.35rem 0.5rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-primary);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.8);
		cursor: pointer;
	}

	:global(.dark) .slider-group.native-tag select {
		background: linear-gradient(180deg, #222 0%, #1a1a1a 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.slider-label {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
		min-width: 3.5rem;
	}

	.slider-group input[type='range'] {
		flex: 1;
		min-width: 60px;
		height: 8px;
		appearance: none;
		background: linear-gradient(180deg, #d0d0d0 0%, #e0e0e0 100%);
		border-radius: 4px;
		cursor: pointer;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.15),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .slider-group input[type='range'] {
		background: linear-gradient(180deg, #1a1a1a 0%, #252525 100%);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.slider-group input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border-radius: 50%;
		cursor: pointer;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
		transition: transform 0.1s ease-out;
	}

	.slider-group input[type='range']::-webkit-slider-thumb:hover {
		transform: scale(1.1);
	}

	.slider-group input[type='range']::-moz-range-thumb {
		width: 18px;
		height: 18px;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border: none;
		border-radius: 50%;
		cursor: pointer;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	.slider-value {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		min-width: 2.5rem;
		text-align: right;
	}

	/* Toggle switch */
	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 22px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-track {
		display: block;
		width: 100%;
		height: 100%;
		background: linear-gradient(180deg, #d0d0d0 0%, #e0e0e0 100%);
		border-radius: 11px;
		transition: all 0.2s ease-out;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.15),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .toggle-track {
		background: linear-gradient(180deg, #1a1a1a 0%, #252525 100%);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.toggle input:checked ~ .toggle-track {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.8),
			0 2px 8px rgba(1, 178, 255, 0.3);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border-radius: 50%;
		transition: transform 0.2s ease-out;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		pointer-events: none;
	}

	.toggle input:checked ~ .toggle-track .toggle-thumb {
		transform: translateX(18px);
	}

	/* Body-Action Rules */
	.rules-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.rule-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		flex-wrap: wrap;
	}

	:global(.dark) .rule-row {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.rule-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 10rem;
		flex: 1;
	}

	.rule-tag {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		text-transform: capitalize;
	}

	.rule-arrow {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.rule-action-select {
		flex: 1;
		min-width: 6rem;
		padding: 0.35rem 0.5rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-primary);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.8);
		cursor: pointer;
	}

	:global(.dark) .rule-action-select {
		background: linear-gradient(180deg, #222 0%, #1a1a1a 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.rule-sliders {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem 1rem;
		flex: 2;
	}

	.rule-toggle {
		flex-shrink: 0;
	}

	/* Tablet and below */
	@media (max-width: 640px) {
		.page-header {
			margin-bottom: 1rem;
		}

		.page-header h2 {
			font-size: 1.25rem;
		}

		.sections {
			gap: 1.25rem;
		}

		.section h3 {
			margin-bottom: 0.75rem;
		}

		.emotion-main {
			gap: 0.5rem;
		}

		.emotion-name {
			min-width: 5rem;
		}

		.slider-group {
			min-width: 7rem;
		}
	}

	/* Mobile */
	@media (max-width: 520px) {
		.mode-option {
			padding: 0.5rem 0.625rem;
			font-size: 0.75rem;
		}

		.emotion-text-input {
			width: 100%;
		}

		.emotion-toggles {
			margin-left: auto;
		}

		.rule-info {
			width: 100%;
		}

		.rule-sliders {
			width: 100%;
		}
	}
</style>

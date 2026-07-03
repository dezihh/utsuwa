<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import { DEFAULT_PERSONALITY_PRESETS } from '$lib/stores/settings.svelte';

	interface Props {
		name: string;
		systemPrompt: string;
		onNameChange: (name: string) => void;
		onSystemPromptChange: (prompt: string) => void;
		onNext: () => void;
		onBack: () => void;
	}

	let { name, systemPrompt, onNameChange, onSystemPromptChange, onNext, onBack }: Props = $props();

	const isValid = $derived(name.trim().length > 0);
</script>

<div class="ob-step">
	<div class="ob-head">
		<h2 class="ob-title">Name your companion</h2>
		<p class="ob-subtitle">Give your AI companion a name and a personality.</p>
	</div>

	<div class="ob-field">
		<label for="name" class="ob-label">Name</label>
		<input
			id="name"
			type="text"
			class="ob-input"
			value={name}
			oninput={(e) => onNameChange(e.currentTarget.value)}
			placeholder="Enter a name..."
		/>
	</div>

	<div class="form-group">
		<div class="label-row">
			<label for="personality" class="label">Core Personality</label>
			<div class="preset-chips">
				{#each DEFAULT_PERSONALITY_PRESETS.filter(p => p.id !== 'standard') as preset}
					<button
						class="preset-chip"
						class:active={systemPrompt === preset.systemPrompt}
						type="button"
						onclick={() => onSystemPromptChange(preset.systemPrompt)}
					>{preset.name}</button>
				{/each}
			</div>
		</div>

		<textarea
			id="personality"
			class="ob-textarea"
			value={systemPrompt}
			oninput={(e) => onSystemPromptChange(e.currentTarget.value)}
			placeholder="Describe their personality, speaking style, background..."
			rows="5"
		></textarea>
		<span class="ob-hint">This shapes how your companion talks and behaves.</span>
	</div>

	<div class="ob-actions ob-actions--split">
		<button class="btn btn-secondary" onclick={onBack}>
			<Icon name="chevron-left" size={16} />
			Back
		</button>
		<button class="btn btn-primary" onclick={onNext} disabled={!isValid}>
			Next
			<Icon name="chevron-right" size={16} />
		</button>
	</div>
</div>

<style>
	.step-content {
		display: flex;
		flex-direction: column;
		padding: 1.5rem;
		gap: 1.25rem;
	}

	.step-header {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.header-icon {
		position: relative;
		width: 56px;
		height: 56px;
		background: linear-gradient(180deg, #66d9ff 0%, #01B2FF 40%, #0099dd 100%);
		border-radius: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow:
			0 6px 20px rgba(1, 178, 255, 0.4),
			0 3px 8px rgba(0, 0, 0, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 2px rgba(0, 0, 0, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.header-icon-shine {
		position: absolute;
		top: 3px;
		left: 15%;
		right: 15%;
		height: 40%;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.1) 60%, transparent 100%);
		border-radius: 0.75rem 0.75rem 50% 50%;
		pointer-events: none;
	}

	.title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.label {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.preset-chips {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.preset-chip {
		padding: 0.15rem 0.55rem;
		border-radius: 20px;
		border: 1px solid rgba(1, 178, 255, 0.4);
		background: transparent;
		font-size: 0.7rem;
		color: #01B2FF;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.preset-chip:hover,
	.preset-chip.active {
		background: #01B2FF;
		color: #fff;
		border-color: #01B2FF;
	}

	.input {
		padding: 0.75rem 1rem;
		background: linear-gradient(180deg, #f5f5f5 0%, #ffffff 100%);
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		color: var(--text-primary);
		transition: all 0.2s;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.06),
			inset 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.input:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.06),
			0 0 0 3px rgba(1, 178, 255, 0.2),
			0 0 12px rgba(1, 178, 255, 0.15);
	}

	.input::placeholder {
		color: var(--text-tertiary);
	}

	:global(.dark) .input {
		background: linear-gradient(180deg, #1a1a1a 0%, #222222 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 2px rgba(0, 0, 0, 0.2);
	}

	.textarea {
		padding: 0.75rem 1rem;
		background: linear-gradient(180deg, #f5f5f5 0%, #ffffff 100%);
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--text-primary);
		font-family: inherit;
		resize: vertical;
		min-height: 100px;
		line-height: 1.6;
		transition: all 0.2s;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.06),
			inset 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.textarea:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.06),
			0 0 0 3px rgba(1, 178, 255, 0.2),
			0 0 12px rgba(1, 178, 255, 0.15);
	}

	.textarea::placeholder {
		color: var(--text-tertiary);
	}

	:global(.dark) .textarea {
		background: linear-gradient(180deg, #1a1a1a 0%, #222222 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 2px rgba(0, 0, 0, 0.2);
	}

	.hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.actions {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.75rem 1.25rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: var(--radius-full);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.back-btn:hover {
		background: linear-gradient(180deg, #f8f8f8 0%, #e8e8e8 100%);
		color: var(--text-primary);
		transform: translateY(-1px);
		box-shadow:
			0 4px 8px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	.back-btn:active {
		transform: translateY(0);
		background: linear-gradient(180deg, #e8e8e8 0%, #e0e0e0 100%);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	:global(.dark) .back-btn {
		background: linear-gradient(180deg, #333333 0%, #262626 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
	}

	:global(.dark) .back-btn:hover {
		background: linear-gradient(180deg, #404040 0%, #333333 100%);
	}

	.next-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.75rem 1.5rem;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 40%, #0099dd 100%);
		color: white;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: var(--radius-full);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow:
			0 4px 12px rgba(1, 178, 255, 0.35),
			0 2px 4px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
	}

	.next-btn:hover:not(:disabled) {
		background: linear-gradient(180deg, #66d9ff 0%, #1ebfff 40%, #00a6e6 100%);
		transform: translateY(-2px);
		box-shadow:
			0 6px 18px rgba(1, 178, 255, 0.45),
			0 3px 6px rgba(0, 0, 0, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.5);
	}

	.next-btn:active:not(:disabled) {
		transform: translateY(0);
		background: linear-gradient(180deg, #0099dd 0%, #0088cc 100%);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.next-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>


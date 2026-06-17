<script lang="ts">
	import { Icon } from '$lib/components/ui';

	interface EvolutionSuggestion {
		adaptation: string;
		reason: string;
	}

	interface Props {
		suggestions: EvolutionSuggestion[];
		companionName: string;
		onConfirm: (adaptations: string[]) => void;
		onReject: () => void;
		language?: string;
	}

	let { suggestions, companionName, onConfirm, onReject, language }: Props = $props();

	function t(key: string, lang?: string): string {
		const translations: Record<string, Record<string, string>> = {
			evolved: {
				de: 'hat sich entwickelt',
				en: 'has evolved',
				fr: 'a évolué',
				es: 'ha evolucionado'
			},
			description: {
				de: 'Basierend auf euren letzten Gesprächen schlägt {name} folgende Anpassungen vor. Wähle die gewünschten aus:',
				en: 'Based on recent conversations, {name} suggests the following personality adaptations. Select the ones you want to apply:',
				fr: 'Sur la base des conversations récentes, {name} propose les adaptations suivantes. Sélectionne celles que tu veux appliquer :',
				es: 'Basándose en las conversaciones recientes, {name} sugiere las siguientes adaptaciones. Selecciona las que quieres aplicar:'
			},
			keepCurrent: {
				de: 'Behalten',
				en: 'Keep Current',
				fr: 'Garder',
				es: 'Mantener'
			},
			apply: {
				de: 'Übernehmen',
				en: 'Apply',
				fr: 'Appliquer',
				es: 'Aplicar'
			}
		};
		const l = lang?.split('-')[0] ?? 'en';
		const text = translations[key]?.[l] ?? translations[key]?.['en'] ?? key;
		return text.replace('{name}', companionName);
	}

	let selected = $state<Set<number>>(new Set());

	$effect(() => {
		selected = new Set(suggestions.map((_, i) => i));
	});

	function toggleSelection(index: number) {
		const next = new Set(selected);
		if (next.has(index)) {
			next.delete(index);
		} else {
			next.add(index);
		}
		selected = next;
	}

	function handleConfirm() {
		const adaptations = suggestions
			.filter((_, i) => selected.has(i))
			.map((s) => s.adaptation);
		onConfirm(adaptations);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onReject();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Personality Evolution">
	<div class="modal-container">
		<div class="modal-icon">
			<Icon name="sparkles" size={32} />
		</div>

		<h3 class="modal-title">{companionName} {t('evolved', language)}</h3>
		<p class="modal-desc">
			{t('description', language)}
		</p>

		<div class="suggestions-list">
			{#each suggestions as suggestion, i}
				<button
					class="suggestion-card"
					class:selected={selected.has(i)}
					onclick={() => toggleSelection(i)}
					type="button"
				>
					<div class="suggestion-check">
						{#if selected.has(i)}
							<Icon name="check-square" size={18} />
						{:else}
							<Icon name="square" size={18} />
						{/if}
					</div>
					<div class="suggestion-content">
						<div class="suggestion-adaptation">{suggestion.adaptation}</div>
						<div class="suggestion-reason">{suggestion.reason}</div>
					</div>
				</button>
			{/each}
		</div>

		<div class="modal-actions">
			<button class="btn-reject" onclick={onReject}>
				<Icon name="x" size={14} />
				{t('keepCurrent', language)}
			</button>
			<button class="btn-confirm" onclick={handleConfirm} disabled={selected.size === 0}>
				<Icon name="check" size={14} />
				{t('apply', language)} ({selected.size})
			</button>
		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-container {
		width: 100%;
		max-width: 520px;
		background: var(--bg-primary, #ffffff);
		border-radius: 1.25rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		padding: 2rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		animation: slideUp 0.25s ease-out;
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.modal-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		text-align: center;
	}

	.modal-desc {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-secondary);
		text-align: center;
		line-height: 1.5;
	}

	.suggestions-list {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.suggestion-card {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		background: linear-gradient(180deg, rgba(128, 128, 128, 0.04) 0%, rgba(128, 128, 128, 0.02) 100%);
		border: 2px solid transparent;
		border-radius: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
		text-align: left;
	}

	.suggestion-card:hover {
		background: rgba(99, 102, 241, 0.04);
	}

	.suggestion-card.selected {
		border-color: rgba(99, 102, 241, 0.4);
		background: rgba(99, 102, 241, 0.06);
	}

	.suggestion-check {
		color: #6366f1;
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.suggestion-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.suggestion-adaptation {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.suggestion-reason {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		width: 100%;
		margin-top: 0.5rem;
	}

	.btn-reject,
	.btn-confirm {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		border: none;
	}

	.btn-reject {
		background: rgba(128, 128, 128, 0.1);
		color: var(--text-secondary);
	}

	.btn-reject:hover {
		background: rgba(128, 128, 128, 0.2);
	}

	.btn-confirm {
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
	}

	.btn-confirm:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35);
	}

	.btn-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.modal-container {
			padding: 1.5rem;
			border-radius: 1rem;
		}
	}
</style>

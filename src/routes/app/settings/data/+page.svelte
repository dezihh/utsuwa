<script lang="ts">
	import DataManagement from '$lib/components/settings/DataManagement.svelte';
	import { Icon } from '$lib/components/ui';
	import Button from '$lib/components/ui/Button.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { vocabularyStore } from '$lib/stores/vocabulary.svelte';
	import VocabularyModal from '$lib/components/vocabulary/VocabularyModal.svelte';

	let showVocabModal = $state(false);

	$effect(() => {
		vocabularyStore.loadStats('default');
	});

	function toggleVocabularyEnabled() {
		settingsStore.setVocabularyEnabled(!settingsStore.isVocabularyEnabled());
	}
</script>

<div class="page">
	<!-- Vocabulary Section -->
	<div class="vocab-section">
		<h2 class="section-title">Vocabulary Training</h2>
		<p class="section-description">
			Enable vocabulary practice with your companion. The companion can request focused word
			sets using tags like [vocab:category:Begrüßung:10].
		</p>

		<div class="action-card">
			<div class="action-header">
				<Icon name="globe" size={20} />
				<h3>Vocabulary Settings</h3>
			</div>

			<label class="toggle-row">
				<input
					type="checkbox"
					checked={settingsStore.isVocabularyEnabled()}
					onchange={toggleVocabularyEnabled}
				/>
				<span class="toggle-label">Enable Vocabulary Training</span>
			</label>

			<div class="stats-line">
				{vocabularyStore.stats.total.toLocaleString()} words imported,
				{vocabularyStore.stats.known.toLocaleString()} known,
				{vocabularyStore.stats.learning.toLocaleString()} learning
			</div>

			<Button onclick={() => (showVocabModal = true)}>
				{#snippet children()}
					<Icon name="globe" size={16} />
					Open Vocabulary Manager
				{/snippet}
			</Button>
		</div>
	</div>

	<DataManagement />
</div>

{#if showVocabModal}
	<VocabularyModal onClose={() => (showVocabModal = false)} />
{/if}

<style>
	.page {
		max-width: 600px;
	}

	.vocab-section {
		padding: 1.5rem;
	}

	.section-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}

	.section-description {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
	}

	.action-card {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		padding: 1.25rem;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		transition: all 0.15s ease-out;
		margin-bottom: 1.5rem;
	}

	:global(.dark) .action-card {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.action-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		color: #01B2FF;
	}

	.action-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		cursor: pointer;
	}

	.toggle-row input {
		width: 18px;
		height: 18px;
		accent-color: #01B2FF;
		cursor: pointer;
	}

	.toggle-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.stats-line {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
</style>

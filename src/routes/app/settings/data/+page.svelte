<script lang="ts">
	import DataManagement from '$lib/components/settings/DataManagement.svelte';
	import FactLibraryModal from '$lib/components/memory/FactLibraryModal.svelte';
	import { Icon } from '$lib/components/ui';

	let showFactLibrary = $state(false);
</script>

<div class="page">
	<section class="card">
		<h2>Fact Library</h2>
		<p class="description">
			Browse and manage structured facts the companion has learned about you and the world.
		</p>
		<button class="action-btn" onclick={() => (showFactLibrary = true)}>
			<Icon name="book" size={18} />
			<span>Open Fact Library</span>
		</button>
	</section>

	<DataManagement />

	{#if showFactLibrary}
		<FactLibraryModal onClose={() => (showFactLibrary = false)} />
	{/if}
</div>

<style>
	.page {
		max-width: 600px;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.card {
		background: var(--bg-primary);
		border: 1px solid var(--border-light);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}

	.card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.description {
		margin: 0 0 1rem;
		color: var(--text-secondary);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-light);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.action-btn:hover {
		background: var(--accent-muted);
		color: var(--accent);
	}
</style>

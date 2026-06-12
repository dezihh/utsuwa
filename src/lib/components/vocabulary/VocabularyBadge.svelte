<script lang="ts">
	import { vocabularyStore } from '$lib/stores/vocabulary.svelte';

	interface Props {
		characterId?: string;
	}

	let { characterId = 'default' }: Props = $props();

	$effect(() => {
		vocabularyStore.loadStats(characterId);
	});
</script>

<span class="vocab-badge" title="{vocabularyStore.stats.total} Vokabeln">
	📚 {vocabularyStore.stats.total.toLocaleString()} Vokabeln
</span>

<style>
	.vocab-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		padding: 0.25rem 0.5rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 8px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .vocab-badge {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}
</style>

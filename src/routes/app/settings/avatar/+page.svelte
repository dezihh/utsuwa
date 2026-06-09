<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/app/settings/avatar/animations', { replaceState: true });
	});
</script>

<div class="redirect">
	<p>Redirecting to animations...</p>
</div>

<style>
	.redirect {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-neutral-500);
	}
</style>

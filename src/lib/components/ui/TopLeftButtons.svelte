<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import { screenshotStore } from '$lib/stores/screenshot.svelte';

	interface Props {
		onOpenMemoryGraph?: () => void;
		onOpenFactLibrary?: () => void;
		onOpenMemoryInspector?: () => void;
		onBoardClick?: () => void;
		leftOffset?: number;
	}

	let { onOpenMemoryGraph, onOpenFactLibrary, onOpenMemoryInspector, onBoardClick, leftOffset = 0 }: Props = $props();

	function takeScreenshot() {
		screenshotStore.take();
	}
</script>

<div class="top-left-buttons" style="left: calc(1rem + {leftOffset}px)">
	<button class="icon-btn" onclick={takeScreenshot} aria-label="Take screenshot">
		<Icon name="camera" size={20} />
	</button>
	{#if onOpenMemoryGraph}
		<button class="icon-btn" onclick={onOpenMemoryGraph} aria-label="Open memory graph">
			<Icon name="brain" size={20} />
		</button>
	{/if}
	{#if onOpenFactLibrary}
		<button class="icon-btn" onclick={onOpenFactLibrary} aria-label="Open fact library">
			<Icon name="book" size={20} />
		</button>
	{/if}
	{#if onOpenMemoryInspector}
		<button class="icon-btn" onclick={onOpenMemoryInspector} aria-label="Open memory inspector">
			<Icon name="database" size={20} />
		</button>
	{/if}
	{#if onBoardClick}
		<button class="icon-btn" onclick={onBoardClick} aria-label="Photoboard" title="Things you've shown her">
			<Icon name="image" size={20} />
		</button>
	{/if}
</div>

<style>
	.top-left-buttons {
		position: fixed;
		top: 1rem;
		left: 1rem; /* overridden by inline style when sidebar open */
		z-index: 46;
		display: flex;
		gap: 0.5rem;
		transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: var(--bg-tertiary);
		border: none;
		border-radius: var(--radius-full);
		color: var(--text-secondary);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease,
			box-shadow 0.15s ease, transform 0.15s ease;
		box-shadow: var(--shadow-sm);
	}

	.icon-btn:hover {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--bg-tertiary), var(--text-primary) 8%);
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}

	.icon-btn:focus-visible {
		outline: none;
		color: var(--text-primary);
		box-shadow: 0 0 0 3px var(--accent-muted);
	}

	.icon-btn:active {
		color: var(--accent);
		transform: translateY(0) scale(0.96);
		box-shadow: var(--shadow-sm);
	}
</style>

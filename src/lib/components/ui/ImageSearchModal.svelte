<script lang="ts">
	import { imageSearchStore } from '$lib/stores/image-search.svelte'
	import { Icon } from '$lib/components/ui'

	interface Props {
		leftOffset?: number
		rightOffset?: number
	}

	let { leftOffset = 0, rightOffset = 0 }: Props = $props()

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') imageSearchStore.closeModal()
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) imageSearchStore.closeModal()
	}

	function openImage(url: string) {
		window.open(url, '_blank', 'noopener,noreferrer')
	}

	const skeletonCount = 12

	// Compute dynamic CSS variables for sidebar offsets
	const leftVar = $derived(leftOffset > 0 ? `${leftOffset}px` : '1rem')
	const rightVar = $derived(rightOffset > 0 ? `${rightOffset}px` : '1rem')
</script>

<svelte:window onkeydown={handleKeydown} />

{#if imageSearchStore.isOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="modal-overlay"
		onclick={handleOverlayClick}
		onkeydown={() => {}}
		role="dialog"
		aria-modal="true"
		aria-labelledby="image-search-title"
		tabindex="-1"
		style="--panel-left: {leftVar}; --panel-right: {rightVar};"
	>
		<div class="modal-container">
			<!-- Drag handle (touch-friendly) -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="drag-handle" onclick={() => imageSearchStore.closeModal()} role="button" tabindex="0" aria-label="Close image panel">
				<div class="drag-bar"></div>
			</div>

			<!-- Header -->
			<div class="modal-header">
				<div class="modal-title">
					<Icon name="image" size={18} />
					<h2 id="image-search-title">Image Search</h2>
					<span class="query-label">{imageSearchStore.currentQuery}</span>
				</div>
				<button class="close-btn" onclick={() => imageSearchStore.closeModal()} aria-label="Close">
					<Icon name="x" size={14} />
				</button>
			</div>

			<!-- Content -->
			<div class="modal-content">
				{#if imageSearchStore.isLoading}
					<div class="image-grid">
						{#each Array(skeletonCount) as _, i}
							<div class="image-card skeleton" style="animation-delay: {i * 50}ms">
								<div class="skeleton-thumb"></div>
								<div class="skeleton-text"></div>
								<div class="skeleton-text short"></div>
							</div>
						{/each}
					</div>
				{:else if imageSearchStore.error}
					<div class="error-state">
						<Icon name="alert-circle" size={32} />
						<p>{imageSearchStore.error}</p>
					</div>
				{:else if imageSearchStore.results.length === 0}
					<div class="empty-state">
						<Icon name="image-off" size={32} />
						<p>No images found</p>
					</div>
				{:else}
					<div class="image-grid">
						{#each imageSearchStore.results as result}
							<button class="image-card" onclick={() => openImage(result.url)}>
								<div class="image-thumb">
									<img src={result.thumbnail} alt={result.title} loading="lazy" />
								</div>
								<div class="image-meta">
									<span class="image-title" title={result.title}>{result.title}</span>
									<span class="image-source">{result.source}</span>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		top: auto;
		height: calc(100vh - 130px);
		background: rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.2s ease-out;
		/* Prevent background scroll on touch devices */
		overscroll-behavior: contain;
	}

	@media (max-width: 768px) {
		.modal-overlay {
			height: calc(100vh - 100px);
		}
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal-container {
		position: relative;
		width: calc(100% - var(--panel-left) - var(--panel-right));
		max-width: 900px;
		max-height: calc(100vh - 150px);
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(250, 250, 250, 0.98) 100%);
		border: 1px solid rgba(255, 255, 255, 0.6);
		border-radius: 20px 20px 0 0;
		box-shadow:
			0 -8px 40px rgba(0, 0, 0, 0.2),
			0 -2px 12px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		overflow: hidden;
		animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		margin-left: var(--panel-left);
		margin-right: var(--panel-right);
	}

	@media (max-width: 768px) {
		.modal-container {
			width: 100%;
			margin-left: 0;
			margin-right: 0;
			border-radius: 16px 16px 0 0;
		}
	}

	:global(.dark) .modal-container {
		background: linear-gradient(180deg, rgba(30, 30, 30, 0.95) 0%, rgba(20, 20, 20, 0.95) 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 24px 64px rgba(0, 0, 0, 0.5),
			0 8px 24px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
	}

	@keyframes slideUp {
		from {
			transform: translateY(40px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	/* ── Touch-friendly scrollbar ── */
	.modal-content::-webkit-scrollbar {
		width: 12px;
	}

	.modal-content::-webkit-scrollbar-track {
		background: transparent;
	}

	.modal-content::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 999px;
		border: 3px solid transparent;
		background-clip: padding-box;
	}

	.modal-content::-webkit-scrollbar-thumb:hover {
		background: rgba(0, 0, 0, 0.35);
	}

	:global(.dark) .modal-content::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.2);
	}

	:global(.dark) .modal-content::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.35);
	}

	/* Firefox */
	.modal-content {
		scrollbar-width: auto;
		scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
		/* Prevent scroll propagation to background page */
		overscroll-behavior: contain;
		touch-action: pan-y;
	}

	:global(.dark) .modal-content {
		scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		flex-shrink: 0;
	}

	:global(.dark) .modal-header {
		border-bottom-color: rgba(255, 255, 255, 0.06);
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-primary);
	}

	.modal-title h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.query-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		background: var(--bg-tertiary);
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 50%;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .close-btn {
		background: linear-gradient(180deg, #333333 0%, #262626 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
	}

	.close-btn:hover {
		background: linear-gradient(180deg, #e8e8e8 0%, #d8d8d8 100%);
		color: var(--text-primary);
		transform: scale(1.05);
	}

	:global(.dark) .close-btn:hover {
		background: linear-gradient(180deg, #404040 0%, #333333 100%);
	}

	.drag-handle {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0 0.25rem;
		cursor: pointer;
		flex-shrink: 0;
	}

	.drag-bar {
		width: 40px;
		height: 4px;
		background: rgba(0, 0, 0, 0.2);
		border-radius: 999px;
	}

	:global(.dark) .drag-bar {
		background: rgba(255, 255, 255, 0.2);
	}

	.modal-content {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem 1rem 1rem;
		min-height: 0;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
	}

	@media (max-width: 768px) {
		.image-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (max-width: 480px) {
		.image-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.image-card {
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		overflow: hidden;
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		padding: 0;
		text-align: left;
	}

	:global(.dark) .image-card {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.image-card:hover {
		transform: translateY(-3px);
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.12),
			0 4px 8px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .image-card:hover {
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.4),
			0 4px 8px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.image-thumb {
		aspect-ratio: 1;
		overflow: hidden;
		background: var(--bg-tertiary);
	}

	.image-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.2s ease-out;
	}

	.image-card:hover .image-thumb img {
		transform: scale(1.05);
	}

	.image-meta {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem 0.625rem 0.625rem;
		min-width: 0;
	}

	.image-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.image-source {
		font-size: 0.65rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Skeleton */
	.skeleton {
		pointer-events: none;
	}

	.skeleton-thumb {
		aspect-ratio: 1;
		background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
	}

	.skeleton-text {
		height: 0.625rem;
		margin: 0.5rem 0.625rem 0.25rem;
		border-radius: 4px;
		background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
	}

	.skeleton-text.short {
		width: 50%;
		margin-bottom: 0.625rem;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	/* Empty / Error states */
	.empty-state,
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		color: var(--text-tertiary);
	}

	.error-state {
		color: var(--color-error);
	}

	.empty-state p,
	.error-state p {
		margin: 0;
		font-size: 0.875rem;
	}
</style>

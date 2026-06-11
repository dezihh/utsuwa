<script lang="ts">
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import VrmScene from '$lib/components/vrm/VrmScene.svelte';
	import { Icon } from '$lib/components/ui';
	import { goto } from '$app/navigation';

	let editingDescriptionId = $state<string | null>(null);
	let editingDescriptionValue = $state('');
	let descriptionInputRef: HTMLInputElement | null = $state(null);
	let playingAnimationId = $state<string | null>(null);

	function toggleLlmEnabled(id: string) {
		const anim = vrmStore.allAnimations.find((a) => a.id === id);
		if (!anim) return;
		vrmStore.setAnimationLlmEnabled(id, anim.llmEnabled === false);
	}

	function startEditingDescription(id: string, currentDesc: string | undefined) {
		editingDescriptionId = id;
		editingDescriptionValue = currentDesc || '';
		queueMicrotask(() => descriptionInputRef?.focus());
	}

	function saveDescription(id: string) {
		vrmStore.setAnimationDescription(id, editingDescriptionValue.trim());
		editingDescriptionId = null;
		editingDescriptionValue = '';
	}

	function cancelEditingDescription() {
		editingDescriptionId = null;
		editingDescriptionValue = '';
	}

	function handleDescriptionKeydown(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter') saveDescription(id);
		if (e.key === 'Escape') cancelEditingDescription();
	}

	async function removeCustomAnimation(id: string) {
		if (!confirm('Delete this custom animation?')) return;
		await vrmStore.removeAnimation(id);
	}

	function goToUpload() {
		goto('/app/settings/developer');
	}

	function playAnimation(id: string) {
		const anim = vrmStore.allAnimations.find((a) => a.id === id);
		if (!anim || anim.missing) return;
		playingAnimationId = id;
		vrmStore.setCurrentAnimation(id);
		// Auto-reset selection after a short delay so the user can replay
		setTimeout(() => {
			playingAnimationId = null;
			vrmStore.setCurrentAnimation(null);
		}, 3000);
	}

	function stopAnimation() {
		playingAnimationId = null;
		vrmStore.setCurrentAnimation(null);
	}
</script>

<div class="animations-page">
	<div class="page-header">
		<h2>Animation Library</h2>
		<p class="description">
			Manage which animations the LLM can use and how they are described.
			Click the play button on any row to preview it on the current avatar.
			Disabled animations are hidden from the LLM but still playable manually.
		</p>
	</div>

	<div class="anim-layout">
		<!-- Viewport -->
		<div class="viewport-container">
			<div class="viewport">
				<VrmScene centered />
			</div>
			<div class="viewport-controls">
				{#if playingAnimationId}
					<button class="viewport-btn stop" onclick={stopAnimation}>
						<Icon name="square" size={14} />
						Stop
					</button>
				{:else}
					<span class="viewport-hint">Click ▶ in the table to preview</span>
				{/if}
			</div>
		</div>

		<!-- Table -->
		<div class="table-panel">
			<div class="actions-bar">
				<button class="upload-btn" onclick={goToUpload}>
					<Icon name="upload" size={14} />
					Upload VRMA
				</button>
			</div>

			<div class="table-container">
				<table class="anim-table">
					<thead>
						<tr>
							<th class="col-play"></th>
							<th class="col-active">Active</th>
							<th class="col-name">Name</th>
							<th class="col-tag">Tag</th>
							<th class="col-desc">Description</th>
							<th class="col-type">Type</th>
							<th class="col-action"></th>
						</tr>
					</thead>
					<tbody>
						{#each vrmStore.allAnimations as anim}
							<tr class:disabled={anim.llmEnabled === false} class:missing={anim.missing} class:playing={playingAnimationId === anim.id}>
								<td class="col-play">
									<button
										class="play-btn"
										class:playing={playingAnimationId === anim.id}
										disabled={anim.missing}
										onclick={() => playAnimation(anim.id)}
										title={anim.missing ? 'Animation file not found' : 'Preview animation'}
									>
										<Icon name={playingAnimationId === anim.id ? "square" : "play"} size={14} />
									</button>
								</td>
								<td class="col-active">
									<label class="toggle-switch">
										<input
											type="checkbox"
											checked={anim.llmEnabled !== false}
											onchange={() => toggleLlmEnabled(anim.id)}
										/>
										<span class="toggle-slider"></span>
									</label>
								</td>
								<td class="col-name">
									<span class="anim-name">{anim.name}</span>
									{#if anim.missing}
										<span class="missing-badge" title="File not found">!</span>
									{/if}
								</td>
								<td class="col-tag">
									<code class="tag-code">{anim.id}</code>
								</td>
								<td class="col-desc">
									{#if editingDescriptionId === anim.id}
										<input
											bind:this={descriptionInputRef}
											type="text"
											class="desc-input"
											bind:value={editingDescriptionValue}
											onkeydown={(e) => handleDescriptionKeydown(e, anim.id)}
											onblur={() => saveDescription(anim.id)}
											placeholder="What does this animation do?"
										/>
									{:else}
										<button
											class="desc-edit-btn"
											onclick={() => startEditingDescription(anim.id, anim.description)}
											title="Click to edit description"
										>
											{#if anim.description}
												<span class="desc-text">{anim.description}</span>
											{:else}
												<span class="desc-placeholder">Add description...</span>
											{/if}
											<Icon name="pencil" size={12} />
										</button>
									{/if}
								</td>
								<td class="col-type">
									<span class="type-badge" class:custom={!anim.id.startsWith('VRMA_') && !['angry','blush','clapping','goodbye','jump','lookaround','relax','sad-pose','sleepy','surprised-pose','thinking-pose','wave','nod','shake','bow','think','clap','dance'].includes(anim.id)}>
										{anim.id.startsWith('anim-') ? 'Custom' : 'Built-in'}
									</span>
								</td>
								<td class="col-action">
									{#if anim.id.startsWith('anim-')}
										<button
											class="delete-btn"
											onclick={() => removeCustomAnimation(anim.id)}
											title="Delete"
										>
											<Icon name="trash" size={14} />
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<style>
	.animations-page {
		max-width: 1400px;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.page-header {
		margin-bottom: 1rem;
		flex-shrink: 0;
	}

	.page-header h2 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.description {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.anim-layout {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 1.5rem;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* Viewport */
	.viewport-container {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
	}

	.viewport {
		flex: 1;
		min-height: 300px;
		background: linear-gradient(180deg, #f0f0f0 0%, #e5e5e5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		overflow: hidden;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.05),
			0 2px 8px rgba(0, 0, 0, 0.06);
	}

	:global(.dark) .viewport {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.2),
			0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.viewport-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-height: 36px;
	}

	.viewport-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(180deg, #fff0f0 0%, #ffe5e5 100%);
		border: 1px solid rgba(220, 38, 38, 0.2);
		border-radius: 10px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-red-700);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .viewport-btn {
		background: linear-gradient(180deg, #3a2020 0%, #2a1515 100%);
		border-color: rgba(220, 38, 38, 0.3);
		color: var(--color-red-300);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.viewport-btn:hover {
		transform: translateY(-1px);
	}

	.viewport-hint {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		padding: 0.5rem 0;
	}

	/* Table panel */
	.table-panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.actions-bar {
		margin-bottom: 0.75rem;
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 500;
		color: white;
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.upload-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 14px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.table-container {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		overflow: auto;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		flex: 1;
		min-height: 0;
	}

	:global(.dark) .table-container {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.anim-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.anim-table th {
		padding: 0.75rem 1rem;
		text-align: left;
		font-weight: 600;
		color: var(--text-secondary);
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		background: rgba(0, 0, 0, 0.02);
		white-space: nowrap;
	}

	:global(.dark) .anim-table th {
		border-bottom-color: rgba(255, 255, 255, 0.06);
		background: rgba(255, 255, 255, 0.02);
	}

	.anim-table td {
		padding: 0.625rem 1rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
		color: var(--text-primary);
		vertical-align: middle;
	}

	:global(.dark) .anim-table td {
		border-bottom-color: rgba(255, 255, 255, 0.04);
	}

	.anim-table tr:last-child td {
		border-bottom: none;
	}

	.anim-table tr:hover {
		background: rgba(1, 178, 255, 0.04);
	}

	.anim-table tr.disabled {
		opacity: 0.6;
	}

	.anim-table tr.missing {
		background: rgba(255, 100, 100, 0.04);
	}

	.anim-table tr.playing {
		background: rgba(1, 178, 255, 0.08);
	}

	.col-play { width: 44px; text-align: center; }
	.col-active { width: 60px; text-align: center; }
	.col-name { min-width: 120px; }
	.col-tag { width: 100px; }
	.col-desc { width: auto; }
	.col-type { width: 80px; }
	.col-action { width: 50px; text-align: center; }

	/* Play button */
	.play-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border: 1px solid rgba(1, 178, 255, 0.3);
		border-radius: 8px;
		color: #01B2FF;
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 1px 3px rgba(1, 178, 255, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .play-btn {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.35);
		box-shadow:
			0 1px 3px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.play-btn:hover:not(:disabled) {
		transform: scale(1.1);
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	.play-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
		transform: none;
	}

	.play-btn.playing {
		background: linear-gradient(180deg, #01b2ff 0%, #0090d4 100%);
		border-color: rgba(1, 178, 255, 0.5);
		color: white;
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(1, 178, 255, 0.4); }
		50% { box-shadow: 0 0 0 6px rgba(1, 178, 255, 0); }
	}

	/* Toggle switch */
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 36px;
		height: 20px;
		cursor: pointer;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: linear-gradient(180deg, #d0d0d0 0%, #c0c0c0 100%);
		border-radius: 20px;
		transition: 0.2s;
		box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
	}

	:global(.dark) .toggle-slider {
		background: linear-gradient(180deg, #444 0%, #333 100%);
	}

	.toggle-slider::before {
		position: absolute;
		content: '';
		height: 16px;
		width: 16px;
		left: 2px;
		bottom: 2px;
		background: white;
		border-radius: 50%;
		transition: 0.2s;
		box-shadow: 0 1px 3px rgba(0,0,0,0.3);
	}

	.toggle-switch input:checked + .toggle-slider {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
	}

	.toggle-switch input:checked + .toggle-slider::before {
		transform: translateX(16px);
	}

	/* Name */
	.anim-name {
		font-weight: 500;
	}

	.missing-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		margin-left: 0.25rem;
		background: #ff6b6b;
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
		border-radius: 50%;
	}

	/* Tag */
	.tag-code {
		font-family: 'SF Mono', Monaco, monospace;
		font-size: 0.75rem;
		padding: 0.2rem 0.4rem;
		background: rgba(0, 0, 0, 0.05);
		border-radius: 6px;
		color: var(--text-secondary);
	}

	:global(.dark) .tag-code {
		background: rgba(255, 255, 255, 0.06);
	}

	/* Description */
	.desc-edit-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: 1px dashed rgba(0, 0, 0, 0.15);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease;
		max-width: 100%;
	}

	:global(.dark) .desc-edit-btn {
		border-color: rgba(255, 255, 255, 0.1);
	}

	.desc-edit-btn:hover {
		background: rgba(1, 178, 255, 0.08);
		border-color: rgba(1, 178, 255, 0.3);
		color: var(--text-primary);
	}

	.desc-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 280px;
		display: inline-block;
	}

	.desc-placeholder {
		color: var(--text-tertiary);
		font-style: italic;
	}

	.desc-input {
		width: 100%;
		max-width: 300px;
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
		border: 1px solid #01B2FF;
		border-radius: 8px;
		background: var(--bg-primary);
		color: var(--text-primary);
		outline: none;
		box-shadow: 0 0 0 3px rgba(1, 178, 255, 0.15);
	}

	/* Type badge */
	.type-badge {
		display: inline-block;
		padding: 0.2rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.05);
		color: var(--text-tertiary);
	}

	:global(.dark) .type-badge {
		background: rgba(255, 255, 255, 0.06);
	}

	.type-badge.custom {
		background: rgba(1, 178, 255, 0.1);
		color: #01B2FF;
	}

	/* Delete button */
	.delete-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.delete-btn:hover {
		background: rgba(255, 100, 100, 0.1);
		color: #ff6b6b;
	}

	@media (max-width: 900px) {
		.anim-layout {
			grid-template-columns: 1fr;
			grid-template-rows: 280px 1fr;
		}

		.viewport {
			min-height: 240px;
			max-height: 280px;
		}
	}

	@media (max-width: 640px) {
		.page-header {
			margin-bottom: 0.75rem;
		}

		.page-header h2 {
			font-size: 1.25rem;
		}

		.description {
			font-size: 0.8125rem;
		}

		.anim-layout {
			grid-template-rows: 200px 1fr;
		}

		.viewport {
			min-height: 180px;
			max-height: 200px;
		}

		.anim-table {
			font-size: 0.8125rem;
		}

		.anim-table th,
		.anim-table td {
			padding: 0.5rem 0.625rem;
		}

		.col-type,
		.col-tag {
			display: none;
		}

		.desc-text {
			max-width: 120px;
		}
	}
</style>

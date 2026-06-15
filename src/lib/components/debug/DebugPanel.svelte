<script lang="ts">
	import { debugStore } from '$lib/stores/debug.svelte';
	import { Icon } from '$lib/components/ui';

	let selectedCategory = $state<string>('all');
	let searchQuery = $state('');

	const categories = [
		{ id: 'all', label: 'All', color: '#888' },
		{ id: 'prompt', label: 'Prompts', color: '#4aa8ff' },
		{ id: 'memory', label: 'Memory', color: '#a855f7' },
		{ id: 'session', label: 'Sessions', color: '#22c55e' },
		{ id: 'fact', label: 'Facts', color: '#f59e0b' },
		{ id: 'evolution', label: 'Evolution', color: '#ec4899' },
		{ id: 'speech', label: 'Speech', color: '#f97316' },
		{ id: 'general', label: 'General', color: '#9ca3af' }
	];

	const filteredLogs = $derived.by(() => {
		let logs = debugStore.logEntries;
		if (selectedCategory !== 'all') {
			logs = logs.filter((l) => l.category === selectedCategory);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			logs = logs.filter((l) =>
				l.title.toLowerCase().includes(q) || l.content.toLowerCase().includes(q)
			);
		}
		return logs;
	});

	function formatTime(date: Date): string {
		return date.toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function getCategoryColor(cat: string): string {
		return categories.find((c) => c.id === cat)?.color ?? '#888';
	}

	let expandedEntries = $state<Set<number>>(new Set());

	function toggleExpand(id: number) {
		const next = new Set(expandedEntries);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedEntries = next;
	}
</script>

{#if debugStore.panelVisible}
	<div class="debug-panel">
		<div class="debug-header">
			<div class="debug-title">
				<Icon name="terminal" size={14} />
				<span>Debug Log</span>
				<span class="debug-count">{debugStore.logEntries.length}</span>
			</div>
			<div class="debug-actions">
				<input
					type="text"
					class="debug-search"
					placeholder="Search..."
					bind:value={searchQuery}
				/>
				<button class="debug-btn" onclick={() => debugStore.clearLogs()} title="Clear">
					<Icon name="trash-2" size={13} />
				</button>
				<button class="debug-btn" onclick={() => debugStore.togglePanel()} title="Close">
					<Icon name="x" size={13} />
				</button>
			</div>
		</div>

		<div class="debug-filters">
			{#each categories as cat}
				<button
					class="debug-filter"
					class:active={selectedCategory === cat.id}
					style="--filter-color: {cat.color}"
					onclick={() => selectedCategory = cat.id}
				>
					{cat.label}
				</button>
			{/each}
		</div>

		<div class="debug-entries">
			{#if filteredLogs.length === 0}
				<div class="debug-empty">
					<p>No log entries yet.</p>
					<p class="debug-empty-hint">
						Logs are generated from now on. Make sure logging categories are enabled under
						<strong>Settings &gt; Developer &gt; Debug Logging</strong>.
					</p>
				</div>
			{:else}
				{#each filteredLogs as entry, i (entry.id)}
					<div class="debug-entry" class:expanded={expandedEntries.has(i)}>
						<button class="debug-entry-header" onclick={() => toggleExpand(entry.id)}>
							<span class="debug-dot" style="background: {getCategoryColor(entry.category)}"></span>
							<span class="debug-time">{formatTime(entry.timestamp)}</span>
							<span class="debug-category">[{entry.category}]</span>
							<span class="debug-entry-title">{entry.title}</span>
							<Icon name={expandedEntries.has(entry.id) ? 'chevron-down' : 'chevron-right'} size={12} />
						</button>
						{#if expandedEntries.has(entry.id)}
							<pre class="debug-content">{entry.content}</pre>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.debug-panel {
		position: relative;
		width: 100%;
		height: var(--debug-panel-height, 0px);
		min-height: 180px;
		display: flex;
		flex-direction: column;
		background: rgba(20, 20, 30, 0.97);
		backdrop-filter: blur(12px);
		border-top: 1px solid rgba(255, 255, 255, 0.12);
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
		color: #e0e0e0;
		z-index: 50;
	}

	.debug-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		gap: 0.5rem;
	}

	.debug-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
		font-size: 0.8rem;
	}

	.debug-count {
		background: rgba(255, 255, 255, 0.1);
		padding: 0.05rem 0.4rem;
		border-radius: 10px;
		font-size: 0.65rem;
	}

	.debug-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.debug-search {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		color: inherit;
		font-size: 0.7rem;
		width: 120px;
		outline: none;
	}

	.debug-search:focus {
		border-color: rgba(74, 168, 255, 0.5);
	}

	.debug-btn {
		background: rgba(255, 255, 255, 0.06);
		border: none;
		border-radius: 6px;
		padding: 0.3rem;
		color: inherit;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
	}

	.debug-btn:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.debug-filters {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 0.8rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		overflow-x: auto;
	}

	.debug-filter {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		padding: 0.2rem 0.6rem;
		color: inherit;
		font-size: 0.7rem;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.debug-filter:hover {
		border-color: var(--filter-color, rgba(255, 255, 255, 0.2));
	}

	.debug-filter.active {
		background: var(--filter-color, rgba(255, 255, 255, 0.1));
		border-color: var(--filter-color, rgba(255, 255, 255, 0.3));
		color: white;
	}

	.debug-entries {
		flex: 1;
		overflow-y: auto;
		padding: 0.3rem 0;
	}

	.debug-empty {
		padding: 2rem;
		text-align: center;
		color: rgba(255, 255, 255, 0.3);
		font-style: italic;
	}

	.debug-empty-hint {
		margin-top: 0.5rem;
		font-size: 0.7rem;
		font-style: normal;
		color: rgba(255, 255, 255, 0.45);
	}

	.debug-empty-hint strong {
		color: rgba(255, 255, 255, 0.65);
	}

	.debug-entry {
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
	}

	.debug-entry-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.8rem;
		width: 100%;
		background: transparent;
		border: none;
		color: inherit;
		font-size: inherit;
		font-family: inherit;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.debug-entry-header:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.debug-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.debug-time {
		color: rgba(255, 255, 255, 0.35);
		font-size: 0.65rem;
		flex-shrink: 0;
	}

	.debug-category {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.65rem;
		flex-shrink: 0;
	}

	.debug-entry-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.debug-content {
		margin: 0;
		padding: 0.6rem 1rem 0.8rem 2.4rem;
		background: rgba(0, 0, 0, 0.25);
		color: rgba(255, 255, 255, 0.75);
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 50vh;
		overflow-y: auto;
	}
</style>

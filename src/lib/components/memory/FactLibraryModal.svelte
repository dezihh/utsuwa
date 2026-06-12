<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import type { FactLibraryEntry } from '$lib/types/memory';
	import * as memoryStorage from '$lib/services/storage/memory';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let entries = $state<FactLibraryEntry[]>([]);
	let isLoading = $state(true);
	let searchQuery = $state('');
	let filterType = $state('');
	let filterCategory = $state('');
	let sortBy = $state<'confidence' | 'createdAt' | 'reviewCount'>('createdAt');
	let sortDesc = $state(true);

	// Edit state
	let editingId = $state<number | null>(null);
	let editValue = $state('');
	let editCategory = $state('');
	let editTags = $state('');
	let editConfidence = $state(0.5);

	// Add state
	let isAdding = $state(false);
	let addKey = $state('');
	let addValue = $state('');
	let addType = $state('vocab');
	let addCategory = $state('');
	let addTags = $state('');
	let addConfidence = $state(0.5);

	// Import state
	let showImport = $state(false);
	let importText = $state('');
	let importType = $state('vocab');
	let importCategory = $state('');
	let importDelimiter = $state('auto');
	let importCount = $state(0);
	let importErrors = $state<string[]>([]);

	// Load entries
	async function loadEntries() {
		isLoading = true;
		try {
			const all = await memoryStorage.getFactLibraryEntries({ characterId: 'default' });
			entries = all;
		} catch (e) {
			console.error('[FactLibrary] Failed to load entries:', e);
		} finally {
			isLoading = false;
		}
	}

	// Filtered and sorted entries
	const filteredEntries = $derived(() => {
		let result = [...entries];

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(e) =>
					e.key.toLowerCase().includes(q) ||
					e.value.toLowerCase().includes(q) ||
					e.type.toLowerCase().includes(q) ||
					(e.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
			);
		}

		if (filterType) {
			result = result.filter((e) => e.type === filterType);
		}

		if (filterCategory) {
			result = result.filter((e) => e.category === filterCategory);
		}

		result.sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'confidence':
					cmp = a.confidence - b.confidence;
					break;
				case 'reviewCount':
					cmp = a.reviewCount - b.reviewCount;
					break;
				case 'createdAt':
					cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
			}
			return sortDesc ? -cmp : cmp;
		});

		return result;
	});

	const uniqueTypes = $derived(() => [...new Set(entries.map((e) => e.type))].sort());
	const uniqueCategories = $derived(() =>
		[...new Set(entries.map((e) => e.category).filter(Boolean))].sort()
	);

	function startEdit(entry: FactLibraryEntry) {
		if (entry.id === undefined) return;
		isAdding = false;
		editingId = entry.id;
		editValue = entry.value;
		editCategory = entry.category || '';
		editTags = entry.tags?.join(', ') || '';
		editConfidence = entry.confidence;
	}

	function cancelEdit() {
		editingId = null;
	}

	function startAdd() {
		editingId = null;
		isAdding = true;
		addKey = '';
		addValue = '';
		addType = 'vocab';
		addCategory = '';
		addTags = '';
		addConfidence = 0.5;
	}

	function cancelAdd() {
		isAdding = false;
	}

	async function saveAdd() {
		if (!addKey.trim() || !addValue.trim()) return;
		try {
			await memoryStorage.saveFactLibraryEntry({
				key: addKey.trim(),
				value: addValue.trim(),
				type: addType.trim() || 'vocab',
				category: addCategory.trim() || undefined,
				tags: addTags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				confidence: Math.max(0, Math.min(1, addConfidence)),
				characterId: 'default'
			});
			isAdding = false;
			await loadEntries();
		} catch (e) {
			console.error('[FactLibrary] Failed to add entry:', e);
		}
	}

	// ── Bulk import ─────────────────────────────────────────────────────────
	function detectDelimiter(line: string): string | null {
		const delimiters = ['\t', ',', ';', '|', ' = ', ': ', ' – ', ' - ']
		for (const d of delimiters) {
			if (line.includes(d)) return d
		}
		return null
	}

	function parseImportLine(line: string): { key: string; value: string } | null {
		line = line.trim()
		if (!line || line.startsWith('#')) return null

		const delim = importDelimiter === 'auto' ? detectDelimiter(line) : importDelimiter
		if (!delim) return null

		const idx = line.indexOf(delim)
		if (idx === -1) return null

		const key = line.slice(0, idx).trim()
		const value = line.slice(idx + delim.length).trim()
		if (!key || !value) return null

		return { key, value }
	}

	function previewImport() {
		const lines = importText.split('\n')
		const parsed: { key: string; value: string }[] = []
		const errors: string[] = []

		for (let i = 0; i < lines.length; i++) {
			const result = parseImportLine(lines[i])
			if (result) {
				parsed.push(result)
			} else if (lines[i].trim() && !lines[i].trim().startsWith('#')) {
				errors.push(`Line ${i + 1}: "${lines[i].trim()}"`)
			}
		}

		importCount = parsed.length
		importErrors = errors
		return parsed
	}

	async function executeImport() {
		const entries = previewImport()
		if (entries.length === 0) return

		let saved = 0
		for (const e of entries) {
			try {
				await memoryStorage.saveFactLibraryEntry({
					key: e.key,
					value: e.value,
					type: importType.trim() || 'vocab',
					category: importCategory.trim() || undefined,
					tags: [],
					confidence: 0.5,
					characterId: 'default'
				})
				saved++
			} catch (err) {
				console.error('[FactLibrary] Import failed for:', e.key, err)
			}
		}

		showImport = false
		importText = ''
		importCount = 0
		importErrors = []
		await loadEntries()
		console.log(`[FactLibrary] Imported ${saved} of ${entries.length} entries`)
	}

	async function saveEdit(id: number) {
		try {
			await memoryStorage.updateFactLibraryEntry(id, {
				value: editValue,
				category: editCategory || undefined,
				tags: editTags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				confidence: Math.max(0, Math.min(1, editConfidence))
			});
			editingId = null;
			await loadEntries();
		} catch (e) {
			console.error('[FactLibrary] Failed to update entry:', e);
		}
	}

	async function deleteEntry(id: number) {
		if (!confirm('Delete this entry permanently?')) return;
		try {
			await memoryStorage.deleteFactLibraryEntry(id);
			await loadEntries();
		} catch (e) {
			console.error('[FactLibrary] Failed to delete entry:', e);
		}
	}

	async function reviewEntry(id: number) {
		try {
			await memoryStorage.incrementFactLibraryReview(id, 0.15);
			await loadEntries();
		} catch (e) {
			console.error('[FactLibrary] Failed to review entry:', e);
		}
	}

	function formatDate(date: Date | undefined): string {
		if (!date) return '—';
		return new Date(date).toLocaleDateString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function confidenceColor(confidence: number): string {
		if (confidence >= 0.8) return '#22c55e';
		if (confidence >= 0.5) return '#f59e0b';
		return '#ef4444';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	// Load on mount
	$effect(() => {
		loadEntries();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Fact Library">
	<div class="modal-container">
		<header class="modal-header">
			<div class="header-info">
				<Icon name="book" size={20} />
				<h2>Fact Library</h2>
				<span class="entry-count">{filteredEntries().length} / {entries.length}</span>
			</div>
			<div class="header-actions">
				<button class="add-btn" onclick={startAdd} aria-label="Add entry">
					<Icon name="plus" size={16} />
					<span>Add</span>
				</button>
				<button class="close-btn" onclick={onClose} aria-label="Close">
					<Icon name="x" size={20} />
				</button>
			</div>
		</header>

		<div class="filters">
			<div class="filter-row">
				<input
					type="text"
					class="search-input"
					placeholder="Search key, value, tags..."
					bind:value={searchQuery}
				/>
				<select class="filter-select" bind:value={filterType}>
					<option value="">All Types</option>
					{#each uniqueTypes() as t}
						<option value={t}>{t}</option>
					{/each}
				</select>
				<select class="filter-select" bind:value={filterCategory}>
					<option value="">All Categories</option>
					{#each uniqueCategories() as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
				<select class="filter-select" bind:value={sortBy}>
					<option value="createdAt">Date</option>
					<option value="confidence">Confidence</option>
					<option value="reviewCount">Reviews</option>
				</select>
				<button class="sort-dir-btn" onclick={() => (sortDesc = !sortDesc)} aria-label="Toggle sort">
					<Icon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={16} />
				</button>
			</div>
		</div>

		<div class="modal-content">
			{#if isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<p>Loading entries...</p>
				</div>
			{:else if filteredEntries().length === 0}
				<div class="empty-state">
					<Icon name="book" size={48} />
					<p>No entries found</p>
					{#if entries.length === 0}
						<p class="hint">Facts are automatically extracted from conversations.</p>
					{/if}
				</div>
			{:else}
				<div class="entries-list">
						{#if isAdding}
							<div class="entry-card adding">
								<div class="edit-form">
									<div class="edit-field">
										<span class="field-label">Key</span>
										<input type="text" bind:value={addKey} placeholder="e.g. Serendipity" />
									</div>
									<div class="edit-field">
										<span class="field-label">Value</span>
										<textarea bind:value={addValue} rows={3} placeholder="Definition or explanation..."></textarea>
									</div>
									<div class="edit-row">
										<div class="edit-field">
											<span class="field-label">Type</span>
											<input type="text" bind:value={addType} placeholder="vocab, exam_fact, concept..." />
										</div>
										<div class="edit-field">
											<span class="field-label">Category</span>
											<input type="text" bind:value={addCategory} placeholder="e.g. Spanish" />
										</div>
										<div class="edit-field">
											<span class="field-label">Confidence</span>
											<input type="number" min="0" max="1" step="0.05" bind:value={addConfidence} />
										</div>
									</div>
									<div class="edit-field">
										<span class="field-label">Tags (comma separated)</span>
										<input type="text" bind:value={addTags} placeholder="spanish, b1, noun..." />
									</div>
									<div class="edit-actions">
										<button class="btn-save" onclick={saveAdd}>
											<Icon name="check" size={14} />
											Save
										</button>
										<button class="btn-cancel" onclick={cancelAdd}>
											<Icon name="x" size={14} />
											Cancel
										</button>
									</div>
								</div>
							</div>
						{/if}
					{#each filteredEntries() as entry (entry.id)}
						<div class="entry-card">
							{#if editingId === entry.id}
								<div class="edit-form">
									<div class="edit-field">
										<span class="field-label">Value</span>
										<textarea bind:value={editValue} rows={3}></textarea>
									</div>
									<div class="edit-row">
										<div class="edit-field">
											<span class="field-label">Category</span>
											<input type="text" bind:value={editCategory} />
										</div>
										<div class="edit-field">
											<span class="field-label">Confidence</span>
											<input
												type="number"
												min="0"
												max="1"
												step="0.05"
												bind:value={editConfidence}
											/>
										</div>
									</div>
									<div class="edit-field">
										<span class="field-label">Tags (comma separated)</span>
										<input type="text" bind:value={editTags} />
									</div>
									<div class="edit-actions">
										<button class="btn-save" onclick={() => entry.id !== undefined && saveEdit(entry.id)}>
											<Icon name="check" size={14} />
											Save
										</button>
										<button class="btn-cancel" onclick={cancelEdit}>
											<Icon name="x" size={14} />
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<div class="entry-header">
									<div class="entry-type-badge">{entry.type}</div>
									<div class="entry-actions">
										<button
											class="action-btn"
											onclick={() => reviewEntry(entry.id!)}
											title="Review (+confidence)"
										>
											<Icon name="check-circle" size={14} />
										</button>
										<button
											class="action-btn"
											onclick={() => startEdit(entry)}
											title="Edit"
										>
											<Icon name="pencil" size={14} />
										</button>
										<button
											class="action-btn danger"
											onclick={() => entry.id !== undefined && deleteEntry(entry.id)}
											title="Delete"
										>
											<Icon name="trash-2" size={14} />
										</button>
									</div>
								</div>

								<div class="entry-key">{entry.key}</div>
								<div class="entry-value">{entry.value}</div>

								{#if entry.category}
									<div class="entry-category">
										<Icon name="folder" size={12} />
										{entry.category}
									</div>
								{/if}

								{#if entry.tags && entry.tags.length > 0}
									<div class="entry-tags">
										{#each entry.tags as tag}
											<span class="tag">{tag}</span>
										{/each}
									</div>
								{/if}

								<div class="entry-meta">
									<span
										class="confidence-bar"
										style="background: linear-gradient(90deg, {confidenceColor(entry.confidence)} 0%, {confidenceColor(entry.confidence)} {entry.confidence * 100}%, rgba(128,128,128,0.2) {entry.confidence * 100}%, rgba(128,128,128,0.2) 100%);"
									>
										{Math.round(entry.confidence * 100)}%
									</span>
									<span class="meta-item">
										<Icon name="refresh-cw" size={12} />
										{entry.reviewCount}
									</span>
									<span class="meta-item">
										<Icon name="clock" size={12} />
										{formatDate(entry.createdAt)}
									</span>
									{#if entry.lastReviewedAt}
										<span class="meta-item">
											<Icon name="check-circle" size={12} />
											{formatDate(entry.lastReviewedAt)}
										</span>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
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
		max-width: 900px;
		max-height: 85vh;
		background: var(--bg-primary, #ffffff);
		border-radius: 1rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slideUp 0.2s ease-out;
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

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		flex-shrink: 0;
	}

	:global(.dark) .modal-header {
		background: linear-gradient(180deg, #252525 0%, #1a1a1a 100%);
		border-bottom-color: rgba(255, 255, 255, 0.08);
	}

	.header-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-secondary);
	}

	.header-info h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.entry-count {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		background: rgba(128, 128, 128, 0.15);
		padding: 0.125rem 0.5rem;
		border-radius: 1rem;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		background: linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 0.5rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	:global(.dark) .close-btn {
		background: linear-gradient(180deg, #333333 0%, #262626 100%);
		border-color: rgba(255, 255, 255, 0.1);
	}

	.close-btn:hover {
		background: linear-gradient(180deg, #e8e8e8 0%, #d8d8d8 100%);
		transform: translateY(-1px);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.add-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		background: linear-gradient(180deg, #01B2FF 0%, #0099dd 100%);
		border: none;
		border-radius: 0.5rem;
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.add-btn:hover {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		transform: translateY(-1px);
	}

	.entry-card.adding {
		border: 2px solid rgba(1, 178, 255, 0.3);
		background: linear-gradient(180deg, rgba(1, 178, 255, 0.04) 0%, rgba(1, 178, 255, 0.02) 100%);
	}

	.filters {
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		flex-shrink: 0;
	}

	.filter-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 0.5rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 0.875rem;
	}

	.search-input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.filter-select {
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 0.5rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.sort-dir-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 0.5rem;
		background: var(--bg-primary);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.modal-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem 1.5rem;
	}

	.loading-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 4rem;
		color: var(--text-tertiary);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(128, 128, 128, 0.2);
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.hint {
		font-size: 0.875rem;
		max-width: 300px;
		text-align: center;
	}

	.entries-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.entry-card {
		background: linear-gradient(180deg, rgba(128, 128, 128, 0.04) 0%, rgba(128, 128, 128, 0.02) 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 0.75rem;
		padding: 1rem;
		transition: all 0.15s;
	}

	.entry-card:hover {
		border-color: rgba(99, 102, 241, 0.3);
		box-shadow: 0 2px 8px rgba(99, 102, 241, 0.08);
	}

	.entry-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.entry-type-badge {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.5rem;
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border-radius: 0.25rem;
	}

	.entry-actions {
		display: flex;
		gap: 0.25rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.action-btn:hover {
		background: rgba(128, 128, 128, 0.1);
		color: var(--text-primary);
	}

	.action-btn.danger:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.entry-key {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}

	.entry-value {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.entry-category {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 0.5rem;
	}

	.entry-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.tag {
		font-size: 0.6875rem;
		padding: 0.125rem 0.375rem;
		background: rgba(128, 128, 128, 0.1);
		color: var(--text-tertiary);
		border-radius: 0.25rem;
	}

	.entry-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(0, 0, 0, 0.04);
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.confidence-bar {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-weight: 600;
		font-size: 0.6875rem;
		color: white;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}

	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	/* Edit form */
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.edit-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.edit-field .field-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.edit-field input,
	.edit-field textarea {
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 0.5rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 0.875rem;
		font-family: inherit;
	}

	.edit-field input:focus,
	.edit-field textarea:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.edit-row {
		display: flex;
		gap: 0.75rem;
	}

	.edit-row .edit-field {
		flex: 1;
	}

	.edit-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.btn-save,
	.btn-cancel {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		border: none;
	}

	.btn-save {
		background: #6366f1;
		color: white;
	}

	.btn-save:hover {
		background: #4f46e5;
	}

	.btn-cancel {
		background: rgba(128, 128, 128, 0.1);
		color: var(--text-secondary);
	}

	.btn-cancel:hover {
		background: rgba(128, 128, 128, 0.2);
	}

	@media (max-width: 640px) {
		.modal-overlay {
			padding: 0;
		}

		.modal-container {
			max-height: 100vh;
			border-radius: 0;
		}

		.filter-row {
			flex-direction: column;
			align-items: stretch;
		}

		.search-input,
		.filter-select {
			width: 100%;
		}
	}
</style>

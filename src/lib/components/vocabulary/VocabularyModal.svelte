<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import Button from '$lib/components/ui/Button.svelte';
	import { vocabularyStore } from '$lib/stores/vocabulary.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		saveVocabularyEntries,
		deleteAllVocabulary,
		getVocabularyStats
	} from '$lib/services/storage/vocabulary';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let csvText = $state('');
	let isDragging = $state(false);
	let previewRows = $state<string[][]>([]);
	let importError = $state<string | null>(null);
	let isImporting = $state(false);
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);
	let importSourceLang = $state('de');
	let importTargetLang = $state('es');

	// Current character ID for multi-character isolation
	const currentCharacterId = $derived(settingsStore.getActiveProfileId());

	$effect(() => {
		vocabularyStore.loadStats(currentCharacterId);
	});

	function parseCSVLine(line: string): string[] {
		const result: string[] = [];
		let current = '';
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '"') {
				if (inQuotes && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = !inQuotes;
				}
			} else if (char === ',' && !inQuotes) {
				result.push(current.trim());
				current = '';
			} else {
				current += char;
			}
		}
		result.push(current.trim());
		return result;
	}

	function updatePreview() {
		importError = null;
		if (!csvText.trim()) {
			previewRows = [];
			return;
		}
		const lines = csvText.trim().split('\n').filter((l) => l.trim());
		if (lines.length === 0) {
			previewRows = [];
			return;
		}

		// Check if first row looks like headers
		const firstRow = parseCSVLine(lines[0]);
		const hasHeaders = firstRow.some((cell) =>
			['sourceword', 'targetword', 'context', 'category', 'level', 'tags'].includes(cell.toLowerCase())
		);
		const dataLines = hasHeaders ? lines.slice(1) : lines;
		previewRows = dataLines.slice(0, 5).map(parseCSVLine);
	}

	function handleTextInput() {
		updatePreview();
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		const file = e.dataTransfer?.files[0];
		if (file && file.type === 'text/csv') {
			const reader = new FileReader();
			reader.onload = (ev) => {
				csvText = (ev.target?.result as string) || '';
				updatePreview();
			};
			reader.readAsText(file);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	async function handleImport() {
		if (!csvText.trim()) return;
		importError = null;
		isImporting = true;

		try {
			const lines = csvText.trim().split('\n').filter((l) => l.trim());
			if (lines.length === 0) throw new Error('No data to import');

			const firstRow = parseCSVLine(lines[0]);
			const hasHeaders = firstRow.some((cell) =>
				['sourceword', 'targetword', 'context', 'category', 'level', 'tags'].includes(cell.toLowerCase())
			);
			const dataLines = hasHeaders ? lines.slice(1) : lines;

			const entries = dataLines
				.map((line) => {
					const cols = parseCSVLine(line);
					if (cols.length < 2) return null;
					return {
						sourceLang: importSourceLang,
						targetLang: importTargetLang,
						sourceWord: cols[0] || '',
						targetWord: cols[1] || '',
						context: cols[2] || undefined,
						category: cols[3] || 'General',
						level: cols[4] || 'A1',
						tags: cols[5] ? cols[5].split(',').map((t) => t.trim()).filter(Boolean) : [],
						characterId: currentCharacterId
					};
				})
				.filter((e): e is NonNullable<typeof e> => e !== null && !!e.sourceWord && !!e.targetWord);

			if (entries.length === 0) throw new Error('No valid entries found');

			await saveVocabularyEntries(entries);
			csvText = '';
			previewRows = [];
			await vocabularyStore.loadStats(currentCharacterId);
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed';
		} finally {
			isImporting = false;
		}
	}

	async function handleDeleteAll() {
		if (!showDeleteConfirm) {
			showDeleteConfirm = true;
			return;
		}
		isDeleting = true;
		try {
			await deleteAllVocabulary(currentCharacterId);
			showDeleteConfirm = false;
			await vocabularyStore.loadStats(currentCharacterId);
		} catch (e) {
			console.error('[Vocabulary] Failed to delete all:', e);
		} finally {
			isDeleting = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick} onkeydown={() => {}} role="dialog" aria-modal="true" aria-labelledby="vocab-modal-title" tabindex="-1">
	<div class="modal-container">
		<div class="modal-header">
			<h2 id="vocab-modal-title" class="modal-title">
				<Icon name="globe" size={20} />
				Vocabulary Manager
			</h2>
			<button class="close-btn" onclick={onClose} aria-label="Close">
				<Icon name="x" size={14} />
			</button>
		</div>

		<!-- Stats -->
		<div class="stats-row">
			<div class="stat-card">
				<span class="stat-value">{vocabularyStore.stats.total.toLocaleString()}</span>
				<span class="stat-label">Total</span>
			</div>
			<div class="stat-card known">
				<span class="stat-value">{vocabularyStore.stats.known.toLocaleString()}</span>
				<span class="stat-label">Known</span>
			</div>
			<div class="stat-card learning">
				<span class="stat-value">{vocabularyStore.stats.learning.toLocaleString()}</span>
				<span class="stat-label">Learning</span>
			</div>
		</div>

		<!-- CSV Upload -->
		<div class="section-label">Import from CSV</div>

		<!-- Language pair -->
		<div class="lang-row">
			<label class="lang-field">
				<span class="lang-label">Learning language (source)</span>
				<select bind:value={importSourceLang} class="lang-select">
					<option value="de">German (de)</option>
					<option value="en">English (en)</option>
					<option value="es">Spanish (es)</option>
					<option value="fr">French (fr)</option>
					<option value="it">Italian (it)</option>
					<option value="pt">Portuguese (pt)</option>
					<option value="ja">Japanese (ja)</option>
					<option value="zh">Chinese (zh)</option>
					<option value="ko">Korean (ko)</option>
					<option value="ru">Russian (ru)</option>
					<option value="nl">Dutch (nl)</option>
					<option value="pl">Polish (pl)</option>
					<option value="tr">Turkish (tr)</option>
					<option value="ar">Arabic (ar)</option>
				</select>
			</label>
			<span class="lang-arrow">→</span>
			<label class="lang-field">
				<span class="lang-label">Native language (target)</span>
				<select bind:value={importTargetLang} class="lang-select">
					<option value="de">German (de)</option>
					<option value="en">English (en)</option>
					<option value="es">Spanish (es)</option>
					<option value="fr">French (fr)</option>
					<option value="it">Italian (it)</option>
					<option value="pt">Portuguese (pt)</option>
					<option value="ja">Japanese (ja)</option>
					<option value="zh">Chinese (zh)</option>
					<option value="ko">Korean (ko)</option>
					<option value="ru">Russian (ru)</option>
					<option value="nl">Dutch (nl)</option>
					<option value="pl">Polish (pl)</option>
					<option value="tr">Turkish (tr)</option>
					<option value="ar">Arabic (ar)</option>
				</select>
			</label>
		</div>

		<div
			class="drop-zone"
			class:dragging={isDragging}
			ondrop={handleDrop}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			role="button"
			tabindex="0"
			aria-label="Drop CSV file here"
		>
			<Icon name="upload" size={24} />
			<span class="drop-text">Drag & drop a CSV file or paste below</span>
			<span class="drop-hint">Format: sourceWord, targetWord, context, category, level, tags</span>
		</div>

		<textarea
			class="csv-textarea"
			placeholder="Hola,Hola,¡Hola! ¿Qué tal?,Begrüßung,A1,grußformel&#10;Casa,Casa,Mi casa es grande,Wohnen,A1,noun"
			bind:value={csvText}
			oninput={handleTextInput}
			rows={5}
		></textarea>

		{#if previewRows.length > 0}
			<div class="preview-section">
				<div class="preview-header">Preview (first {previewRows.length} rows)</div>
				<table class="preview-table">
					<thead>
						<tr>
							<th>Source</th>
							<th>Target</th>
							<th>Category</th>
							<th>Level</th>
						</tr>
					</thead>
					<tbody>
						{#each previewRows as row}
							<tr>
								<td>{row[0] || '-'}</td>
								<td>{row[1] || '-'}</td>
								<td>{row[3] || '-'}</td>
								<td>{row[4] || '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if importError}
			<div class="error-message">
				<Icon name="warning" size={16} />
				{importError}
			</div>
		{/if}

		<div class="actions-row">
			<Button onclick={handleImport} disabled={isImporting || previewRows.length === 0}>
				{#snippet children()}
					{#if isImporting}
						Importing...
					{:else}
						<Icon name="upload" size={16} />
						Import {previewRows.length > 0 ? 'Vocabulary' : ''}
					{/if}
				{/snippet}
			</Button>
		</div>

		<!-- Danger zone -->
		<div class="danger-zone">
			<div class="section-label danger">Danger Zone</div>
			{#if showDeleteConfirm}
				<div class="confirm-message">
					<Icon name="warning" size={16} />
					Delete all vocabulary? This cannot be undone.
				</div>
				<div class="confirm-actions">
					<Button variant="secondary" onclick={() => (showDeleteConfirm = false)}>
						{#snippet children()}Cancel{/snippet}
					</Button>
					<Button variant="danger" onclick={handleDeleteAll} disabled={isDeleting}>
						{#snippet children()}
							{#if isDeleting}
								Deleting...
							{:else}
								<Icon name="trash" size={16} />
								Yes, Delete All
							{/if}
						{/snippet}
					</Button>
				</div>
			{:else}
				<Button variant="danger" onclick={handleDeleteAll}>
					{#snippet children()}
						<Icon name="trash" size={16} />
						Delete All Vocabulary
					{/snippet}
				</Button>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.2s ease-out;
		padding: 1rem;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal-container {
		position: relative;
		background: linear-gradient(180deg, #ffffff 0%, #f8f9fa 100%);
		border: 1px solid rgba(255, 255, 255, 0.8);
		border-radius: 20px;
		max-width: 520px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		padding: 1.5rem;
		animation: slideUp 0.25s ease-out;
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.2),
			0 8px 24px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .modal-container {
		background: linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.5),
			0 8px 24px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
	}

	@keyframes slideUp {
		from {
			transform: translateY(16px) scale(0.98);
			opacity: 0;
		}
		to {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
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

	.stats-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.875rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 14px;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .stat-card {
		background: linear-gradient(180deg, #252525 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: #01B2FF;
	}

	.stat-card.known .stat-value {
		color: #22c55e;
	}

	.stat-card.learning .stat-value {
		color: #f59e0b;
	}

	.stat-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin-top: 0.25rem;
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
	}

	.section-label.danger {
		color: oklch(55% 0.18 25);
	}

	:global(.dark) .section-label.danger {
		color: oklch(70% 0.15 25);
	}

	.lang-row {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.lang-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.lang-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}

	.lang-select {
		padding: 0.375rem 0.5rem;
		border-radius: 8px;
		border: 1px solid rgba(0, 0, 0, 0.1);
		background: var(--surface-1, #f8f8f8);
		color: var(--text-primary);
		font-size: 0.8rem;
		cursor: pointer;
	}

	:global(.dark) .lang-select {
		background: #2a2a2a;
		border-color: rgba(255, 255, 255, 0.1);
		color: var(--text-primary);
	}

	.lang-arrow {
		font-size: 1rem;
		color: var(--text-tertiary);
		padding-bottom: 0.35rem;
		flex-shrink: 0;
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 2px dashed rgba(1, 178, 255, 0.3);
		border-radius: 14px;
		color: var(--text-secondary);
		transition: all 0.15s ease-out;
		margin-bottom: 0.75rem;
		cursor: pointer;
	}

	:global(.dark) .drop-zone {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(1, 178, 255, 0.25);
	}

	.drop-zone.dragging {
		border-color: rgba(1, 178, 255, 0.7);
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
	}

	:global(.dark) .drop-zone.dragging {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
	}

	.drop-text {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.drop-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-align: center;
	}

	.csv-textarea {
		width: 100%;
		padding: 0.875rem 1rem;
		font-size: 0.875rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 12px;
		background: linear-gradient(180deg, #ffffff 0%, #f8f8f8 100%);
		color: var(--text-primary);
		resize: vertical;
		outline: none;
		transition: border-color 0.15s;
		margin-bottom: 0.75rem;
	}

	:global(.dark) .csv-textarea {
		background: linear-gradient(180deg, #1f1f1f 0%, #1a1a1a 100%);
		border-color: rgba(255, 255, 255, 0.1);
		color: var(--text-primary);
	}

	.csv-textarea:focus {
		border-color: rgba(1, 178, 255, 0.5);
		box-shadow: 0 0 0 3px rgba(1, 178, 255, 0.1);
	}

	.preview-section {
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 12px;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		overflow-x: auto;
	}

	:global(.dark) .preview-section {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.06);
	}

	.preview-header {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
	}

	.preview-table {
		width: 100%;
		font-size: 0.8rem;
		border-collapse: collapse;
	}

	.preview-table th,
	.preview-table td {
		padding: 0.375rem 0.5rem;
		text-align: left;
		color: var(--text-secondary);
	}

	.preview-table th {
		font-weight: 600;
		color: var(--text-primary);
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}

	:global(.dark) .preview-table th {
		border-color: rgba(255, 255, 255, 0.08);
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: linear-gradient(180deg, #fff5f5 0%, #ffebeb 100%);
		border: 1px solid oklch(65% 0.15 25 / 0.3);
		border-radius: 12px;
		color: oklch(50% 0.18 25);
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
	}

	:global(.dark) .error-message {
		background: linear-gradient(180deg, #3a2020 0%, #2a1515 100%);
		color: oklch(70% 0.15 25);
	}

	.actions-row {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 1.25rem;
	}

	.danger-zone {
		padding-top: 1rem;
		border-top: 1px solid rgba(0, 0, 0, 0.08);
	}

	:global(.dark) .danger-zone {
		border-color: rgba(255, 255, 255, 0.08);
	}

	.confirm-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: linear-gradient(180deg, #fffbf0 0%, #fff5e5 100%);
		border: 1px solid oklch(70% 0.15 70 / 0.3);
		border-radius: 12px;
		color: oklch(45% 0.15 70);
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
	}

	:global(.dark) .confirm-message {
		background: linear-gradient(180deg, #3a3020 0%, #2a2515 100%);
		color: oklch(75% 0.12 70);
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
	}
</style>

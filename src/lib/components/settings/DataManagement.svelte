<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import Button from '$lib/components/ui/Button.svelte';
	import { pop, slideOpen } from '$lib/utils/motion';
	import {
		exportSave,
		importSave,
		validateSaveFile,
		getSaveFilePreview,
		downloadSaveFile,
		clearAllData,
		resetMemory,
		resetCharacterData,
		type SaveFile,
		type SaveFilePreview,
		type LegacySaveFile,
	type ExportOptions,
	type ExportSizeEstimate,
	DEFAULT_EXPORT_OPTIONS,
	estimateExportSizes

	} from '$lib/db/export';
	import {
		getSyncStatus,
		pushProfile,
		pullProfile,
		rememberPin,
		getSessionPin,
		clearSessionPin,
		type SyncStatus
	} from '$lib/services/profile-sync';
	import { onMount } from 'svelte';

	let isExporting = $state(false);
	let isImporting = $state(false);
	let isClearing = $state(false);
	// Export options (VRM models, animations, keepsakes can be large)
	let exportOptions = $state<ExportOptions>({ ...DEFAULT_EXPORT_OPTIONS });
	let exportSizes = $state<ExportSizeEstimate | null>(null);

	let showClearConfirm = $state(false);
	let isResetting = $state(false);
	let showResetConfirm = $state(false);
	let isResettingCharacter = $state(false);
	let showResetCharacterConfirm = $state(false);

	let importFile = $state<File | null>(null);
	let importPreview = $state<SaveFilePreview | null>(null);
	let importMode = $state<'merge' | 'replace'>('replace');
	let importError = $state<string | null>(null);
	let importSuccess = $state<{ imported: number; skipped: number } | null>(null);

	let fileInput: HTMLInputElement;

	// Cloud sync state
	let syncStatus = $state<SyncStatus | null>(null);
	let syncPin = $state('');
	let syncNewPin = $state('');
	let syncError = $state<string | null>(null);
	let syncSuccess = $state<string | null>(null);
	let isSyncing = $state(false);
	async function loadExportSizes() {
		exportSizes = await estimateExportSizes();
	}

	let showPinSetup = $state(false);
	let showSyncPull = $state(false);

	onMount(async () => {
		syncStatus = await getSyncStatus();
		await loadExportSizes();
		if (syncStatus.enabled) {
			syncPin = getSessionPin();
			// Keep server profiles small by default
			exportOptions.includeKeepsakes = false;
		}
	});

	async function handlePush() {
		syncError = null;
		syncSuccess = null;
		isSyncing = true;
		try {
			const result = await pushProfile(syncPin, showPinSetup ? syncNewPin : undefined, exportOptions);
			if (!result.ok) {
				syncError = result.error ?? 'Save failed';
			} else {
				rememberPin(syncPin);
				syncSuccess = 'Profile saved to server';
				showPinSetup = false;
				syncNewPin = '';
				syncStatus = await getSyncStatus();
		await loadExportSizes();
			}
		} finally {
			isSyncing = false;
		}
	}

	async function handlePull() {
		syncError = null;
		syncSuccess = null;
		isSyncing = true;
		try {
			const result = await pullProfile(syncPin, 'replace');
			if (!result.ok) {
				syncError = result.error ?? 'Load failed';
			} else {
				rememberPin(syncPin);
				syncSuccess = `Loaded ${result.imported} records — reloading…`;
				setTimeout(() => window.location.reload(), 1500);
			}
		} finally {
			isSyncing = false;
		}
	}

	async function handleExport() {
		isExporting = true;
		try {
			const saveFile = await exportSave(exportOptions);
			downloadSaveFile(saveFile);
		} catch (e) {
			console.error('Export failed:', e);
		} finally {
			isExporting = false;
		}
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (!file) return;

		importFile = file;
		importError = null;
		importSuccess = null;
		importPreview = null;

		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const json = JSON.parse(e.target?.result as string);
				const validated = validateSaveFile(json);

				if (!validated) {
					importError = 'Invalid save file format';
					importFile = null;
					return;
				}

				importPreview = getSaveFilePreview(validated);
			} catch {
				importError = 'Failed to parse JSON file';
				importFile = null;
			}
		};
		reader.readAsText(file);
	}

	async function handleImport() {
		if (!importFile || !importPreview) return;

		isImporting = true;
		importError = null;

		try {
			const reader = new FileReader();
			const saveFile = await new Promise<SaveFile | LegacySaveFile>((resolve, reject) => {
				reader.onload = (e) => {
					try {
						const json = JSON.parse(e.target?.result as string);
						const validated = validateSaveFile(json);
						if (!validated) reject(new Error('Invalid save file'));
						else resolve(validated);
					} catch {
						reject(new Error('Failed to parse file'));
					}
				};
				reader.onerror = () => reject(new Error('Failed to read file'));
				reader.readAsText(importFile!);
			});

			const result = await importSave(saveFile, importMode);
			importSuccess = result;
			importFile = null;
			importPreview = null;

			// Refresh the page after a short delay to reload stores
			setTimeout(() => {
				window.location.reload();
			}, 1500);
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed';
		} finally {
			isImporting = false;
		}
	}

	function cancelImport() {
		importFile = null;
		importPreview = null;
		importError = null;
		importSuccess = null;
		if (fileInput) fileInput.value = '';
	}

	async function handleClear() {
		if (!showClearConfirm) {
			showClearConfirm = true;
			return;
		}

		isClearing = true;
		try {
			await clearAllData();
			showClearConfirm = false;
			// Flag onboarding for the fresh start after reload
			if (typeof sessionStorage !== 'undefined') {
				sessionStorage.setItem('utsuwa-show-onboarding', '1');
			}
			// Refresh to reset stores
			setTimeout(() => {
				window.location.reload();
			}, 500);
		} catch (e) {
			console.error('Clear failed:', e);
		} finally {
			isClearing = false;
		}
	}

	async function handleResetMemory() {
		if (!showResetConfirm) {
			showResetConfirm = true;
			return;
		}

		isResetting = true;
		try {
			await resetMemory();
			showResetConfirm = false;
			// Refresh to reset stores
			setTimeout(() => {
				window.location.reload();
			}, 500);
		} catch (e) {
			console.error('Reset memory failed:', e);
		} finally {
			isResetting = false;
		}
	}

	async function handleResetCharacterData() {
		if (!showResetCharacterConfirm) {
			showResetCharacterConfirm = true;
			return;
		}

		isResettingCharacter = true;
		try {
			await resetCharacterData();
			showResetCharacterConfirm = false;
			// Refresh to reset stores
			setTimeout(() => {
				window.location.reload();
			}, 500);
		} catch (e) {
			console.error('Reset character data failed:', e);
		} finally {
			isResettingCharacter = false;
		}
	}
	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
		const value = bytes / Math.pow(1000, i);
		return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(date: Date): string {
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="data-management">
	<h2 class="section-title">Data Management</h2>
	<p class="section-description">
		Export your data as a save file or import a previous save. All data is stored locally in your
		browser.
	</p>

	<div class="actions">
		<!-- Export -->
		<div class="action-card">
			<div class="action-header">
				<Icon name="download" size={20} />
				<h3>Export Save</h3>
			</div>
			<p class="action-description">
				Download your data as a JSON file. Memory, character, and settings are always included.
				Large optional items can be toggled below.
			</p>

			<div class="export-options">
				<label class="export-option">
					<input
						type="checkbox"
						bind:checked={exportOptions.includeVrmModels}
					/>
					<span class="export-option-label">VRM Models</span>
					<span class="export-option-size">{formatBytes(exportSizes?.vrmModels ?? 0)}</span>
				</label>
				<label class="export-option">
					<input
						type="checkbox"
						bind:checked={exportOptions.includeVrmAnimations}
					/>
					<span class="export-option-label">VRMA Animations</span>
					<span class="export-option-size">{formatBytes(exportSizes?.vrmAnimations ?? 0)}</span>
				</label>
				<label class="export-option">
					<input
						type="checkbox"
						bind:checked={exportOptions.includeKeepsakes}
					/>
					<span class="export-option-label">Keepsakes / Photos</span>
					<span class="export-option-size">{formatBytes(exportSizes?.keepsakes ?? 0)}</span>
				</label>
				<div class="export-option-total">
					<span>Selected optional total:</span>
					<span>
						{formatBytes(
							(exportOptions.includeVrmModels ? (exportSizes?.vrmModels ?? 0) : 0) +
							(exportOptions.includeVrmAnimations ? (exportSizes?.vrmAnimations ?? 0) : 0) +
							(exportOptions.includeKeepsakes ? (exportSizes?.keepsakes ?? 0) : 0)
						)}
					</span>
				</div>
			</div>

			<Button onclick={handleExport} disabled={isExporting}>
				{#snippet children()}
					{#if isExporting}
						Exporting...
					{:else}
						<Icon name="download" size={16} />
						Download Save File
					{/if}
				{/snippet}
			</Button>
		</div>

		<!-- Import -->
		<div class="action-card">
			<div class="action-header">
				<Icon name="upload" size={20} />
				<h3>Import Save</h3>
			</div>
			<p class="action-description">Restore data from a previously exported save file.</p>

			<input
				type="file"
				accept=".json"
				onchange={handleFileSelect}
				bind:this={fileInput}
				class="file-input"
			/>

			{#if importError}
				<div class="error-message" transition:pop={{ duration: 200, y: 6 }}>
					<Icon name="warning" size={16} />
					{importError}
				</div>
			{/if}

			{#if importSuccess}
				<div class="success-message" transition:pop={{ duration: 200, y: 6 }}>
					<Icon name="check" size={16} />
					Imported {importSuccess.imported} records
					{#if importSuccess.skipped > 0}
						(skipped {importSuccess.skipped})
					{/if}
					- Reloading...
				</div>
			{/if}

			{#if importPreview && !importSuccess}
				<div class="import-preview" transition:slideOpen>
					<div class="preview-header">
						<Icon name="file" size={16} />
						<span>Save File Preview</span>
					</div>
					<div class="preview-details">
						<div class="preview-row">
							<span class="label">Exported:</span>
							<span class="value">{formatDate(importPreview.exportedAt)}</span>
						</div>
						<div class="preview-row">
							<span class="label">Character:</span>
							<span class="value">{importPreview.characterName || 'Unknown'}</span>
						</div>
						<div class="preview-row">
							<span class="label">Records:</span>
							<span class="value">
								{importPreview.counts.facts} facts, {importPreview.counts.conversationTurns} messages
							</span>
						</div>
						{#if importPreview.hasSettings}
							<div class="preview-row">
								<span class="label">Settings:</span>
								<span class="value">
									✓ Included
									{#if importPreview.counts.vrmModels}({importPreview.counts.vrmModels} VRM model{importPreview.counts.vrmModels !== 1 ? 's' : ''}){/if}
									{#if importPreview.counts.expressionProfiles} ({importPreview.counts.expressionProfiles} expression profile{importPreview.counts.expressionProfiles !== 1 ? 's' : ''}){/if}
								</span>
							</div>
						{/if}
					</div>

					<div class="import-mode">
						<label class="mode-option">
							<input type="radio" bind:group={importMode} value="replace" />
							<span class="mode-label">Replace</span>
							<span class="mode-description">Clear existing data and import</span>
						</label>
						<label class="mode-option">
							<input type="radio" bind:group={importMode} value="merge" />
							<span class="mode-label">Merge</span>
							<span class="mode-description">Add to existing data (skip duplicates)</span>
						</label>
					</div>

					<div class="import-actions">
						<Button variant="secondary" onclick={cancelImport}>
							{#snippet children()}Cancel{/snippet}
						</Button>
						<Button onclick={handleImport} disabled={isImporting}>
							{#snippet children()}
								{#if isImporting}
									Importing...
								{:else}
									<Icon name="upload" size={16} />
									Import
								{/if}
							{/snippet}
						</Button>
					</div>
				</div>
			{/if}
		</div>


		<!-- Reset Memory -->
		<div class="action-card warning">
			<div class="action-header">
				<Icon name="brain" size={20} />
				<h3>Reset Memory</h3>
			</div>
			<p class="action-description">
				Reset memory only: clears conversation history, facts, sessions, events, and the fact library. Keeps your
				character profile, settings, VRM models, and expression mappings intact — perfect
				for starting a new game with the same companion.
			</p>

			{#if showResetConfirm}
				<div class="confirm-message">
					<Icon name="warning" size={16} />
					This clears all memory but keeps your current character state and settings. Continue?
				</div>
				<div class="confirm-actions">
					<Button variant="secondary" onclick={() => (showResetConfirm = false)}>
						{#snippet children()}Cancel{/snippet}
					</Button>
					<Button variant="danger" onclick={handleResetMemory} disabled={isResetting}>
						{#snippet children()}
							{#if isResetting}
								Resetting...
							{:else}
								Yes, Reset Memory
							{/if}
						{/snippet}
					</Button>
				</div>
			{:else}
				<Button variant="danger" onclick={handleResetMemory}>
					{#snippet children()}
						<Icon name="brain" size={16} />
						Reset Memory
					{/snippet}
				</Button>
			{/if}
		</div>
		<!-- Reset Character Data -->
		<div class="action-card warning">
			<div class="action-header">
				<Icon name="user" size={20} />
				<h3>Reset Character Data</h3>
			</div>
			<p class="action-description">
				Reset your companion's current state (mood, energy, relationship) and wipe all memory.
				Keeps your settings, VRM model, and expression mappings intact — useful for a fresh start
				with the same avatar and config.
			</p>

			{#if showResetCharacterConfirm}
				<div class="confirm-message">
					<Icon name="warning" size={16} />
					This resets the character state and clears all memory, but keeps settings and VRM. Continue?
				</div>
				<div class="confirm-actions">
					<Button variant="secondary" onclick={() => (showResetCharacterConfirm = false)}>
						{#snippet children()}Cancel{/snippet}
					</Button>
					<Button variant="danger" onclick={handleResetCharacterData} disabled={isResettingCharacter}>
						{#snippet children()}
							{#if isResettingCharacter}
								Resetting...
							{:else}
								Yes, Reset Character Data
							{/if}
						{/snippet}
					</Button>
				</div>
			{:else}
				<Button variant="danger" onclick={handleResetCharacterData}>
					{#snippet children()}
						<Icon name="user" size={16} />
						Reset Character Data
					{/snippet}
				</Button>
			{/if}
		</div>
		<!-- Clear Data -->
		<div class="action-card danger">
			<div class="action-header">
				<Icon name="trash" size={20} />
				<h3>Clear All Data</h3>
			</div>
			<p class="action-description">
				Permanently delete all saved data. This cannot be undone. Consider exporting first.
			</p>

			{#if showClearConfirm}
				<div class="confirm-message" transition:pop={{ duration: 200, y: 6 }}>
					<Icon name="warning" size={16} />
					Are you sure? This will delete all your data permanently.
				</div>
				<div class="confirm-actions">
					<Button variant="secondary" onclick={() => (showClearConfirm = false)}>
						{#snippet children()}Cancel{/snippet}
					</Button>
					<Button variant="danger" onclick={handleClear} disabled={isClearing}>
						{#snippet children()}
							{#if isClearing}
								Clearing...
							{:else}
								Yes, Delete Everything
							{/if}
						{/snippet}
					</Button>
				</div>
			{:else}
				<Button variant="danger" onclick={handleClear}>
					{#snippet children()}
						<Icon name="trash" size={16} />
						Clear All Data
					{/snippet}
				</Button>
			{/if}
		</div>

		<!-- Cloud Sync (only shown when server-side sync is enabled) -->
		{#if syncStatus?.enabled}
			<div class="action-card sync-card">
				<div class="action-header">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="23 4 23 10 17 10"></polyline>
						<polyline points="1 20 1 14 7 14"></polyline>
						<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
					</svg>
					<h3>Cloud Sync</h3>
				</div>
				<p class="action-description">
					Save your profile to this server and restore it on any device in the network.
					{#if !syncStatus.pinSet}
						<strong>No PIN set yet</strong> — set one below to protect your profile.
					{/if}
				</p>
				<p class="action-hint">
					<Icon name="info" size={14} />
					Cloud sync uses the same options as Export Save. Keepsakes/Photos are excluded by default
					to keep server profiles small.
				</p>

				{#if syncError}
					<div class="error-message">
						<Icon name="warning" size={16} />
						{syncError}
					</div>
				{/if}

				{#if syncSuccess}
					<div class="success-message">
						<Icon name="check" size={16} />
						{syncSuccess}
					</div>
				{/if}

				<div class="sync-pin-row">
					<input
						type="password"
						placeholder={syncStatus.pinSet ? 'Enter PIN' : 'Set new PIN'}
						bind:value={syncPin}
						class="pin-input"
					/>
					{#if syncStatus.pinSet}
						<button class="change-pin-link" onclick={() => (showPinSetup = !showPinSetup)}>
							{showPinSetup ? 'Cancel' : 'Change PIN'}
						</button>
					{/if}
				</div>

				{#if showPinSetup || !syncStatus.pinSet}
					<input
						type="password"
						placeholder="New PIN"
						bind:value={syncNewPin}
						class="pin-input"
						style="margin-top: 0.5rem;"
					/>
				{/if}

				<div class="sync-actions">
					<Button onclick={handlePush} disabled={isSyncing || !syncPin}>
						{#snippet children()}
							{#if isSyncing}
								Saving…
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="23 4 23 10 17 10"></polyline>
									<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
								</svg>
								Save to Server
							{/if}
						{/snippet}
					</Button>
					{#if syncStatus.profileExists}
						<Button variant="secondary" onclick={handlePull} disabled={isSyncing || !syncPin}>
							{#snippet children()}
								{#if isSyncing}
									Loading…
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
										<polyline points="1 20 1 14 7 14"></polyline>
										<path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
									</svg>
									Load from Server
								{/if}
							{/snippet}
						</Button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.data-management {
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

	.actions {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.action-card {
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		box-shadow: var(--shadow-sm);
		transition: box-shadow 0.15s ease, border-color 0.15s ease;
	}

	.action-card:hover {
		box-shadow: var(--shadow-md);
	}

	.action-card.danger {
		background: color-mix(in srgb, var(--color-error) 5%, var(--bg-primary));
	}

	.action-card.warning {
		border-color: oklch(70% 0.12 75 / 0.35);
	}

	.action-card.warning .action-header {
		color: oklch(60% 0.15 75);
	}

	:global(.dark) .action-card.warning .action-header {
		color: oklch(75% 0.12 75);
	}

	.action-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		color: var(--accent);
	}

	.action-card.danger .action-header {
		color: var(--color-error);
	}

	.action-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}

	.action-description {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	.file-input {
		display: block;
		width: 100%;
		padding: 0.875rem 1rem;
		font-size: 0.875rem;
		border: 1.5px dashed var(--border-light);
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		color: var(--text-secondary);
		cursor: pointer;
		margin-bottom: 1rem;
		transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	}

	.file-input:hover {
		border-color: var(--accent);
		background: var(--accent-subtle);
		color: var(--text-primary);
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	.error-message :global(svg) {
		color: var(--color-error);
		flex-shrink: 0;
	}

	.success-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: color-mix(in srgb, var(--color-success) 10%, transparent);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	.success-message :global(svg) {
		color: var(--color-success);
		flex-shrink: 0;
	}

	.import-preview {
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.preview-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		color: var(--accent);
		margin-bottom: 0.75rem;
	}

	.preview-details {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.preview-row {
		display: flex;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.preview-row .label {
		color: var(--text-tertiary);
		min-width: 80px;
	}

	.preview-row .value {
		color: var(--text-secondary);
	}

	.import-mode {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.mode-option {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		gap: 0.25rem 0.75rem;
		cursor: pointer;
		padding: 0.75rem;
		background: var(--bg-primary);
		border-radius: var(--radius-md);
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.mode-option:hover {
		background: color-mix(in srgb, var(--bg-primary), var(--text-primary) 4%);
	}

	.mode-option:has(input:checked) {
		background: var(--accent-muted);
	}

	.mode-option input {
		grid-row: span 2;
		margin: 0;
		margin-top: 0.25rem;
		accent-color: var(--accent);
	}

	.mode-label {
		font-weight: 500;
		color: var(--text-primary);
	}

	.mode-description {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.import-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.confirm-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	.confirm-message :global(svg) {
		color: var(--color-warning);
		flex-shrink: 0;
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
	}

	/* Cloud Sync card */
	.sync-card {
		border-color: rgba(1, 178, 255, 0.25);
	}

	.sync-card .action-header {
		color: #01B2FF;
	}

	.sync-pin-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.pin-input {
		flex: 1;
		padding: 0.6rem 0.875rem;
		font-size: 0.875rem;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 10px;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.15s;
	}

	:global(.dark) .pin-input {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.1);
	}

	.pin-input:focus {
		border-color: rgba(1, 178, 255, 0.5);
	}

	.change-pin-link {
		background: none;
		border: none;
		color: #01B2FF;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0;
		white-space: nowrap;
	}

	.sync-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	/* Export options */
	.export-options {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-light);
	}

	.export-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--text-primary);
		cursor: pointer;
	}

	.export-option input[type="checkbox"] {
		margin: 0;
		accent-color: var(--accent);
	}

	.export-option-label {
		flex: 1;
	}

	.export-option-size {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.export-option-total {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		border-top: 1px solid var(--border-light);
		padding-top: 0.5rem;
		margin-top: 0.25rem;
	}

	.action-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--text-tertiary);
		margin-bottom: 1rem;
		line-height: 1.4;
	}

	.action-hint :global(svg) {
		flex-shrink: 0;
		margin-top: 0.1rem;
	}
</style>

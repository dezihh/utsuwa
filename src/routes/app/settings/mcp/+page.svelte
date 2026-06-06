<script lang="ts">
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import type { McpTransport, McpServerConfig } from '$lib/types/mcp';
	import { onMount } from 'svelte';

	// ── Form state (shared for add + edit) ──────────────────────────────────
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let formTransport = $state<McpTransport>('http');
	let formName = $state('');
	let formUrl = $state('');
	let formCommand = $state('');
	let formArgs = $state('');
	let formEnv = $state('');
	let formError = $state('');

	const isEditing = $derived(editingId !== null);

	function resetForm() {
		formName = '';
		formUrl = '';
		formCommand = '';
		formArgs = '';
		formEnv = '';
		formError = '';
		editingId = null;
		showForm = false;
	}

	function openAddForm() {
		editingId = null;
		formTransport = 'http';
		formName = '';
		formUrl = '';
		formCommand = '';
		formArgs = '';
		formEnv = '';
		formError = '';
		showForm = true;
	}

	function openEditForm(server: McpServerConfig) {
		editingId = server.id;
		formTransport = server.transport;
		formName = server.name;
		formUrl = server.url ?? '';
		formCommand = server.command ?? '';
		formArgs = (server.args ?? []).join(' ');
		formEnv = server.env
			? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n')
			: '';
		formError = '';
		showForm = true;
	}

	function parseEnv(raw: string): Record<string, string> {
		const result: Record<string, string> = {};
		for (const line of raw.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eq = trimmed.indexOf('=');
			if (eq < 1) continue;
			result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
		}
		return result;
	}

	function submitForm() {
		formError = '';
		if (!formName.trim()) { formError = 'Name is required'; return; }
		if (formTransport === 'http' && !formUrl.trim()) { formError = 'URL is required'; return; }
		if (formTransport === 'stdio' && !formCommand.trim()) { formError = 'Command is required'; return; }

		const args = formArgs.trim() ? formArgs.trim().split(/\s+/) : [];
		const env = formEnv.trim() ? parseEnv(formEnv) : undefined;

		const data = {
			name: formName.trim(),
			transport: formTransport,
			url: formTransport === 'http' ? formUrl.trim() : undefined,
			command: formTransport === 'stdio' ? formCommand.trim() : undefined,
			args: formTransport === 'stdio' ? args : undefined,
			env: formTransport === 'stdio' ? env : undefined,
		};

		if (isEditing) {
			mcpStore.updateServer(editingId!, data);
		} else {
			mcpStore.addServer({ ...data, enabled: true });
		}
		resetForm();
	}

	onMount(() => {
		mcpStore.refreshTools();
	});
</script>

<div class="page">
	<header class="page-header">
		<h2>MCP Servers</h2>
		<p>Connect to Model Context Protocol servers to give your companion tools like web search, file access, and more.</p>
	</header>

	<div class="sections">
		<!-- Server list -->
		<section class="section">
			<div class="section-header">
				<h3>Connected Servers</h3>
				<button class="add-btn" onclick={() => showForm && !isEditing ? resetForm() : openAddForm()}>
					{showForm && !isEditing ? '✕ Cancel' : '＋ Add Server'}
				</button>
			</div>

			{#if showForm}
				<div class="form-card">
					<div class="form-title">{isEditing ? 'Edit Server' : 'New Server'}</div>
					<div class="form-row">
						<label class="form-label" for="mcp-name">Name</label>
						<input id="mcp-name" class="form-input" bind:value={formName} placeholder="My MCP Server" />
					</div>

					<div class="form-row">
						<label class="form-label" for="mcp-transport">Transport</label>
						<div class="transport-toggle" id="mcp-transport">
							<button
								class="transport-opt"
								class:active={formTransport === 'http'}
								onclick={() => (formTransport = 'http')}
							>HTTP / SSE</button>
							<button
								class="transport-opt"
								class:active={formTransport === 'stdio'}
								onclick={() => (formTransport = 'stdio')}
							>stdio</button>
						</div>
					</div>

					{#if formTransport === 'http'}
						<div class="form-row">
							<label class="form-label" for="mcp-url">URL</label>
							<input
								id="mcp-url"
								class="form-input"
								bind:value={formUrl}
								placeholder="http://localhost:3000/mcp"
								type="url"
							/>
						</div>
					{:else}
						<div class="form-row">
							<label class="form-label" for="mcp-command">Command</label>
							<input id="mcp-command" class="form-input" bind:value={formCommand} placeholder="npx" />
						</div>
						<div class="form-row">
							<label class="form-label" for="mcp-args">Arguments</label>
							<input id="mcp-args" class="form-input" bind:value={formArgs} placeholder="-y @modelcontextprotocol/server-filesystem /path" />
						</div>
						<div class="form-row">
							<label class="form-label" for="mcp-env">
								Env Vars
								<span class="form-hint">KEY=value per line</span>
							</label>
							<textarea
								id="mcp-env"
								class="form-input form-textarea"
								bind:value={formEnv}
								placeholder="SEARXNG_URL=http://192.168.10.4:8090"
								rows="3"
							></textarea>
						</div>
					{/if}

					{#if formError}
						<p class="form-error">{formError}</p>
					{/if}

					<div class="form-actions">
						{#if isEditing}
							<button class="cancel-edit-btn" onclick={resetForm}>Cancel</button>
						{/if}
						<button class="save-btn" onclick={submitForm}>
							{isEditing ? 'Save Changes' : 'Add Server'}
						</button>
					</div>
				</div>
			{/if}

			{#if mcpStore.servers.length === 0 && !showForm}
				<p class="empty-hint">No servers configured. Add one above to get started.</p>
			{/if}

			<ul class="server-list">
				{#each mcpStore.servers as server}
					<li class="server-card">
						<div class="server-main">
							<div class="server-info">
								<span class="server-name">{server.name}</span>
								<span class="server-meta">
									{server.transport === 'http' ? server.url : `${server.command} ${(server.args ?? []).join(' ')}`}
								</span>
								<span class="server-badge transport-{server.transport}">{server.transport}</span>
							</div>
							<div class="server-actions">
								<button
									class="toggle-btn"
									class:enabled={server.enabled}
									onclick={() => mcpStore.toggleServer(server.id)}
									title={server.enabled ? 'Disable' : 'Enable'}
								>
									{server.enabled ? 'On' : 'Off'}
								</button>
								<button
									class="edit-btn"
									onclick={() => openEditForm(server)}
									title="Edit server"
								>✎</button>
								<button
									class="remove-btn"
									onclick={() => mcpStore.removeServer(server.id)}
									title="Remove server"
								>✕</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		</section>

		<!-- Available tools -->
		<section class="section">
			<div class="section-header">
				<h3>Available Tools</h3>
				<button
					class="refresh-btn"
					onclick={() => mcpStore.refreshTools()}
					disabled={mcpStore.isLoadingTools}
				>
					{mcpStore.isLoadingTools ? '⟳ Loading…' : '⟳ Refresh'}
				</button>
			</div>

			{#if mcpStore.toolsError}
				<p class="tools-error">{mcpStore.toolsError}</p>
			{/if}

			{#if mcpStore.tools.length === 0 && !mcpStore.isLoadingTools}
				<p class="empty-hint">
					{mcpStore.enabledServers.length === 0
						? 'Enable a server above to see its tools.'
						: 'No tools found. Check that your MCP servers are running.'}
				</p>
			{:else}
				<ul class="tool-list">
					{#each mcpStore.tools as tool}
						<li class="tool-card">
							<div class="tool-header">
								<span class="tool-name">🔧 {tool.name}</span>
								<span class="tool-server">{tool.serverName}</span>
							</div>
							{#if tool.description}
								<p class="tool-desc">{tool.description}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		height: 100%;
		max-width: 640px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.page-header {
		margin-bottom: 1.5rem;
		flex-shrink: 0;
	}

	.page-header h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.page-header p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.875rem;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		padding-bottom: 1rem;
	}

	.section {
		background: var(--bg-secondary);
		border-radius: 12px;
		padding: 1.25rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.section h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
	}

	.add-btn, .refresh-btn {
		font-size: 0.8rem;
		padding: 0.3rem 0.7rem;
		border-radius: 6px;
		border: 1px solid var(--color-border, #ccc);
		background: var(--bg-primary);
		color: var(--text-primary);
		cursor: pointer;
	}

	.add-btn:hover, .refresh-btn:hover:not(:disabled) {
		background: var(--bg-tertiary);
	}

	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* Form */
	.form-card {
		background: var(--bg-primary);
		border: 1px solid var(--color-border, #ddd);
		border-radius: 10px;
		padding: 1rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.form-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.form-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		min-width: 80px;
	}

	.form-input {
		flex: 1;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--color-border, #ccc);
		border-radius: 6px;
		font-size: 0.85rem;
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.form-textarea {
		resize: vertical;
		font-family: monospace;
		line-height: 1.4;
	}

	.form-hint {
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--text-tertiary, #999);
		margin-left: 0.4rem;
	}

	.transport-toggle {
		display: flex;
		gap: 0.4rem;
	}

	.transport-opt {
		padding: 0.25rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--color-border, #ccc);
		font-size: 0.8rem;
		cursor: pointer;
		background: var(--bg-secondary);
		color: var(--text-secondary);
	}

	.transport-opt.active {
		background: var(--color-primary, #6c63ff);
		color: #fff;
		border-color: var(--color-primary, #6c63ff);
	}

	.form-error {
		font-size: 0.8rem;
		color: #e55;
		margin: 0;
	}

	.save-btn {
		align-self: flex-end;
		padding: 0.4rem 1rem;
		border-radius: 7px;
		border: none;
		background: var(--color-primary, #6c63ff);
		color: #fff;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.save-btn:hover {
		opacity: 0.9;
	}

	/* Server list */
	.server-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.server-card {
		background: var(--bg-primary);
		border: 1px solid var(--color-border, #ddd);
		border-radius: 8px;
		padding: 0.75rem 1rem;
	}

	.server-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.server-info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.server-name {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.server-meta {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.server-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		width: fit-content;
	}

	.server-badge.transport-http {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.server-badge.transport-stdio {
		background: #dcfce7;
		color: #166534;
	}

	.server-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.toggle-btn {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.25rem 0.6rem;
		border-radius: 5px;
		border: 1px solid var(--color-border, #ccc);
		cursor: pointer;
		background: var(--bg-secondary);
		color: var(--text-secondary);
	}

	.toggle-btn.enabled {
		background: #22c55e;
		border-color: #22c55e;
		color: #fff;
	}

	.edit-btn {
		font-size: 0.85rem;
		padding: 0.25rem 0.5rem;
		border-radius: 5px;
		border: 1px solid var(--color-border, #ccc);
		background: var(--bg-secondary);
		color: var(--text-tertiary);
		cursor: pointer;
	}

	.edit-btn:hover {
		color: var(--color-primary, #6c63ff);
		border-color: var(--color-primary, #6c63ff);
	}

	.remove-btn {
		font-size: 0.8rem;
		padding: 0.25rem 0.5rem;
		border-radius: 5px;
		border: 1px solid var(--color-border, #ccc);
		background: var(--bg-secondary);
		color: var(--text-tertiary);
		cursor: pointer;
	}

	.remove-btn:hover {
		color: #e55;
		border-color: #e55;
	}

	.form-title {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.cancel-edit-btn {
		padding: 0.4rem 1rem;
		border-radius: 7px;
		border: 1px solid var(--color-border, #ccc);
		background: var(--bg-secondary);
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.cancel-edit-btn:hover {
		background: var(--bg-tertiary);
	}

	/* Tool list */
	.tool-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tool-card {
		background: var(--bg-primary);
		border: 1px solid var(--color-border, #ddd);
		border-radius: 8px;
		padding: 0.65rem 0.9rem;
	}

	.tool-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.tool-name {
		font-weight: 600;
		font-size: 0.88rem;
		color: var(--text-primary);
	}

	.tool-server {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.tool-desc {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.empty-hint {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		text-align: center;
		padding: 1.5rem 0;
	}

	.tools-error {
		font-size: 0.82rem;
		color: #e55;
		margin: 0 0 0.5rem;
	}
</style>

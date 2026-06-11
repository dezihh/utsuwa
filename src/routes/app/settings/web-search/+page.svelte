<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte'
	import { Icon } from '$lib/components/ui'

	let formUrl = $state(settingsStore.getSearxUrl())
	let testStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle')
	let testMessage = $state('')

	function saveUrl() {
		settingsStore.setSearxUrl(formUrl.trim())
	}

	async function testConnection() {
		const url = formUrl.trim()
		if (!url) {
			testStatus = 'error'
			testMessage = 'Please enter a SearxNG URL'
			return
		}

		testStatus = 'loading'
		testMessage = ''

		try {
			const res = await fetch(`/api/search/images?q=test&searxUrl=${encodeURIComponent(url)}`)
			if (res.ok) {
				testStatus = 'success'
				testMessage = 'Connected successfully'
			} else {
				const data = await res.json().catch(() => ({}))
				testStatus = 'error'
				testMessage = data.error || `HTTP ${res.status}`
			}
		} catch (err) {
			testStatus = 'error'
			testMessage = err instanceof Error ? err.message : 'Connection failed'
		}
	}
</script>

<div class="page">
	<header class="page-header">
		<h2>Web Search</h2>
		<p>Configure image search via SearxNG.</p>
	</header>

	<div class="sections">
		<section class="section">
			<h3>SearxNG</h3>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">SearxNG URL</span>
					<span class="setting-desc">The base URL of your SearxNG instance</span>
				</div>
				<div class="input-group">
					<input
						type="url"
						class="url-input"
						placeholder="http://192.168.10.4:8090"
						bind:value={formUrl}
					/>
				</div>
			</div>

			<div class="setting-row actions-row">
				<div class="test-status" class:success={testStatus === 'success'} class:error={testStatus === 'error'}>
					{#if testStatus === 'loading'}
						<Icon name="loader" size={14} />
					{:else if testStatus === 'success'}
						<Icon name="check" size={14} />
					{:else if testStatus === 'error'}
						<Icon name="alert-circle" size={14} />
					{/if}
					<span>{testMessage}</span>
				</div>
				<div class="action-buttons">
					<button class="test-btn" onclick={testConnection} disabled={testStatus === 'loading'}>
						{testStatus === 'loading' ? 'Testing…' : 'Test'}
					</button>
					<button class="save-btn" onclick={saveUrl}>Save</button>
				</div>
			</div>
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

	.section h3 {
		margin: 0 0 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .setting-row {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.setting-label {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-primary);
	}

	.setting-desc {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.input-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.url-input {
		width: 260px;
		padding: 0.5rem 0.75rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 10px;
		font-size: 0.875rem;
		color: var(--text-primary);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.08),
			0 1px 0 rgba(255, 255, 255, 0.9);
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	:global(.dark) .url-input {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.12);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
		color: var(--text-primary);
	}

	.url-input:focus {
		border-color: #01B2FF;
		box-shadow:
			0 0 0 3px rgba(1, 178, 255, 0.15),
			inset 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.actions-row {
		margin-top: 0.75rem;
		justify-content: space-between;
	}

	.action-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.test-btn,
	.save-btn {
		padding: 0.4rem 1rem;
		border-radius: 10px;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease-out;
		font-family: inherit;
	}

	.test-btn {
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.12);
		color: var(--text-secondary);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .test-btn {
		background: linear-gradient(180deg, #333333 0%, #262626 100%);
		border-color: rgba(255, 255, 255, 0.12);
		color: var(--text-secondary);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.test-btn:hover:not(:disabled) {
		background: linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%);
		color: var(--text-primary);
	}

	:global(.dark) .test-btn:hover:not(:disabled) {
		background: linear-gradient(180deg, #404040 0%, #333333 100%);
	}

	.test-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.save-btn {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		color: white;
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
	}

	.save-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 14px rgba(1, 178, 255, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.test-status {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		min-height: 20px;
	}

	.test-status.success {
		color: var(--color-success);
	}

	.test-status.error {
		color: var(--color-error);
	}

	@media (max-width: 640px) {
		.page-header {
			margin-bottom: 1rem;
		}

		.page-header h2 {
			font-size: 1.25rem;
		}

		.sections {
			gap: 1.25rem;
		}

		.section h3 {
			margin-bottom: 0.75rem;
		}

		.setting-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.url-input {
			width: 100%;
		}

		.actions-row {
			flex-direction: column;
			align-items: stretch;
			gap: 0.75rem;
		}

		.action-buttons {
			align-self: flex-end;
		}
	}
</style>

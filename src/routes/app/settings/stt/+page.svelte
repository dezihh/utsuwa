<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { Icon, ProviderDropdown } from '$lib/components/ui';
</script>

<div class="page">
	<header class="page-header">
		<h2>Voice Input (STT)</h2>
		<p>Configure speech-to-text providers and microphone sensitivity.</p>
	</header>

	<div class="sections">
		<section class="section">
			<div class="service-group">
				<div class="service-header">
					<Icon name="mic" size={14} />
					<span>Voice Input (STT)</span>
				</div>

				<ProviderDropdown
					type="stt"
					value={settingsStore.getProviderConfig('stt-config').activeProvider ?? null}
					onSelect={(id) => settingsStore.setProviderConfig('stt-config', { activeProvider: id })}
					placeholder="Select STT provider..."
				/>

				{#if settingsStore.getProviderConfig('stt-config').activeProvider === 'groq-stt'}
					<p class="stt-hint">Cloud-based Whisper via Groq. Requires an API key.</p>
					<div class="api-key-row">
						<input
							type="password"
							class="api-key-input"
							placeholder="Groq API Key"
							value={settingsStore.getProviderConfig('groq-stt').apiKey ?? ''}
							oninput={(e) => {
								settingsStore.setProviderConfig('groq-stt', { apiKey: e.currentTarget.value });
								settingsStore.markProviderAdded('groq-stt');
							}}
						/>
					</div>
				{:else if settingsStore.getProviderConfig('stt-config').activeProvider === 'whisper-local'}
					<p class="stt-hint">Local faster-whisper server (Docker). No API key required. Adjust URL only if not using default port 8000.</p>
					<div class="api-key-row">
						<input
							type="text"
							class="api-key-input"
							placeholder="http://localhost:8000/v1"
							value={settingsStore.getProviderConfig('whisper-local').baseUrl ?? ''}
							oninput={(e) => {
								settingsStore.setProviderConfig('whisper-local', { baseUrl: e.currentTarget.value });
							}}
						/>
					</div>
					<div class="api-key-row">
						<input
							type="text"
							class="api-key-input"
							placeholder="deepdml/faster-whisper-large-v3-turbo-ct2"
							value={(settingsStore.getProviderConfig('whisper-local') as { model?: string }).model ?? ''}
							oninput={(e) => {
								settingsStore.setProviderConfig('whisper-local', { model: e.currentTarget.value });
							}}
						/>
						<span class="api-key-label">Model ID</span>
					</div>
				{:else if settingsStore.getProviderConfig('stt-config').activeProvider === 'web-speech'}
					<p class="stt-hint">Browser built-in speech recognition. Works in Chrome/Edge without any API key. Not available in Tauri desktop builds.</p>
				{:else}
					<p class="stt-hint">Select a voice input provider above. Local Whisper uses your Docker service on port 8000 — no API key needed.</p>
				{/if}

				<!-- Duplex VAD threshold: shared across all STT providers -->
				<div class="vad-sensitivity-row">
					<span class="vad-sensitivity-label">
						Duplex VAD Sensitivity
						<span class="vad-value">{Math.round((1 - ((settingsStore.getProviderConfig('whisper-local').vadThreshold ?? 0.015) - 0.005) / 0.045) * 100)}%</span>
					</span>
					<input
						type="range"
						class="vad-slider"
						min="0"
						max="100"
						step="1"
						value={Math.round((1 - ((settingsStore.getProviderConfig('whisper-local').vadThreshold ?? 0.015) - 0.005) / 0.045) * 100)}
						oninput={(e) => {
							const pct = Number(e.currentTarget.value) / 100;
							const threshold = +(0.05 - pct * 0.045).toFixed(4);
							settingsStore.setProviderConfig('whisper-local', { vadThreshold: threshold });
						}}
					/>
					<div class="vad-hint">Controls how easily Duplex / VOX mode detects speech. Higher = detects quieter speech; lower = ignores more background noise.</div>
				</div>
			</div>
		</section>
	</div>
</div>

<style>
	.page {
		height: 100%;
		max-width: 720px;
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

	.service-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stt-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}

	.service-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin-bottom: 0.25rem;
	}

	.api-key-row {
		display: flex;
		gap: 0.5rem;
	}

	.api-key-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		display: flex;
		align-items: center;
	}

	.api-key-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		font-size: 0.8rem;
		font-family: 'Share Tech Mono', monospace;
		color: var(--text-primary);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.06),
			0 1px 0 rgba(255, 255, 255, 0.8);
		transition: all 0.15s ease-out;
	}

	:global(.dark) .api-key-input {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.api-key-input:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			0 0 0 3px rgba(1, 178, 255, 0.15),
			inset 0 1px 3px rgba(0, 0, 0, 0.06);
	}

	.vad-sensitivity-row {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.vad-sensitivity-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.vad-value {
		color: var(--text-primary);
		font-weight: 600;
	}

	.vad-slider {
		width: 100%;
		accent-color: #10b981;
		cursor: pointer;
	}

	.vad-hint {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}
</style>

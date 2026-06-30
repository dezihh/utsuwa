<script lang="ts">
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getLLMProvider } from '$lib/services/providers/registry';
	import { Icon, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import {
		fetchModels,
		getCachedModelsForProvider,
		debounce,
		type ModelInfo
	} from '$lib/services/providers/use-model-fetch';

	const consciousnessSettings = $derived(modulesStore.getModuleSettings('consciousness'));
	const isLLMEnabled = $derived.by(() => modulesStore.isModuleEnabled('consciousness'));

	// Dynamic model fetching state for LLM
	let llmIsLoading = $state(false);
	let llmFetchError = $state<string | null>(null);
	let llmDynamicModels = $state<ModelInfo[] | null>(null);
	let lastLocalLLMFetchKey = $state('');

	const staticLLMModels = $derived.by(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return [];
		const provider = getLLMProvider(providerId);
		return provider?.models ?? [];
	});
	// Use dynamic models if available, otherwise static
	const llmModels = $derived(llmDynamicModels ?? staticLLMModels);

	// Check if provider is ready to fetch models
	const llmIsReady = $derived.by(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return false;
		const provider = getLLMProvider(providerId);
		if (!provider) return false;
		const config = settingsStore.getProviderConfig(providerId);
		if (providerId === 'custom-endpoint') {
			return !!config.baseUrl;
		}
		return !!config.apiKey;
	});

	// Fetch LLM models from provider API
	async function fetchLLMModels(targetProvider = consciousnessSettings.activeProvider as string, forceRefresh = false) {
		if (!targetProvider) return;
		const provider = getLLMProvider(targetProvider);
		if (!provider) return;

		const config = settingsStore.getProviderConfig(provider.id);

		if (forceRefresh) {
			settingsStore.clearCachedModels(provider.id);
		} else {
			const cached = getCachedModelsForProvider(provider.id);
			if (cached) {
				llmDynamicModels = cached;
				return;
			}
		}

		await fetchModels({
			providerId: provider.id,
			apiKey: config.apiKey ?? '',
			baseUrl: config.baseUrl,
			isLocal: provider.id === 'custom-endpoint',
			getCurrentProviderId: () => modulesStore.getModuleSettings('consciousness').activeProvider as string,
			onStart: () => {
				llmIsLoading = true;
				llmFetchError = null;
			},
			onSuccess: (models) => {
				llmIsLoading = false;
				llmDynamicModels = models;
				// Auto-select first model if none selected or current selection not in list
				const currentModel = consciousnessSettings.activeModel as string;
				const modelExists = models.some(m => m.id === currentModel);
				if (!currentModel || !modelExists) {
					modulesStore.setModuleSetting('consciousness', 'activeModel', models[0].id);
				}
			},
			onError: (error) => {
				llmIsLoading = false;
				llmFetchError = error;
				llmDynamicModels = provider.id === 'custom-endpoint' ? [] : null;
			},
			onEmpty: () => {
				llmIsLoading = false;
				llmFetchError = provider.id === 'custom-endpoint' ? 'No models found' : 'Using default list';
				llmDynamicModels = provider.id === 'custom-endpoint' ? [] : null;
			},
			onStale: () => {
				llmIsLoading = false;
			}
		});
	}

	// Debounced fetch to avoid rapid API calls
	const debouncedFetchLLMModels = debounce(fetchLLMModels, 300);

	// Load models for the active LLM provider on mount/provider change.
	// Uses cache first, then fetches if credentials/endpoint are available.
	$effect(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;

		// Already loaded — nothing to do
		if (llmDynamicModels !== null) return;

		const provider = getLLMProvider(providerId);
		if (!provider) return;

		// Try cached models first
		const cached = getCachedModelsForProvider(providerId);
		if (cached) {
			llmDynamicModels = cached;
			return;
		}

		// Fetch if configured
		const config = settingsStore.getProviderConfig(providerId);
		if (providerId === 'custom-endpoint') {
			if (config.baseUrl) debouncedFetchLLMModels(providerId);
		} else if (config.apiKey) {
			debouncedFetchLLMModels(providerId);
		}
	});

	function handleLLMProviderChange(providerId: string) {
		modulesStore.setModuleSetting('consciousness', 'activeProvider', providerId);
		const provider = getLLMProvider(providerId);

		// Reset dynamic models when provider changes
		llmDynamicModels = null;
		llmFetchError = null;
		llmIsLoading = false;

		if (provider) {
			// Mark provider as added
			settingsStore.markProviderAdded(providerId);

			if (providerId === 'custom-endpoint') {
				// Default to the "custom" template so the user can enter any URL manually.
				const config = settingsStore.getProviderConfig(providerId);
				if (!config.endpointTemplate) {
					handleLLMEndpointTemplateChange('custom');
				} else {
					applyEndpointTemplate(config.endpointTemplate);
				}
			}

			// Fetch models if ready
			const config = settingsStore.getProviderConfig(providerId);
			if (providerId === 'custom-endpoint') {
				if (config.baseUrl) debouncedFetchLLMModels(providerId);
			} else if (config.apiKey) {
				debouncedFetchLLMModels(providerId);
			}
		}
	}

	function applyEndpointTemplate(templateId: string) {
		const provider = getLLMProvider('custom-endpoint');
		const template = provider?.endpointTemplates?.find(t => t.id === templateId);
		if (!template) return;

		const config = settingsStore.getProviderConfig('custom-endpoint');
		settingsStore.setProviderConfig('custom-endpoint', {
			endpointTemplate: templateId as import('$lib/types').CustomEndpointTemplate,
			baseUrl: template.id === 'custom' ? config.baseUrl : template.baseUrl
		});
		modulesStore.setModuleSetting('consciousness', 'endpointTemplate', templateId);
	}

	function handleLLMEndpointTemplateChange(templateId: string) {
		applyEndpointTemplate(templateId);
		debouncedFetchLLMModels('custom-endpoint');
	}

	function handleLLMBaseUrlChange(baseUrl: string) {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;

		llmFetchError = null;
		settingsStore.setProviderConfig(providerId, { baseUrl });

		// If the user edits the URL away from the selected preset, switch to custom mode.
		if (providerId === 'custom-endpoint') {
			const provider = getLLMProvider('custom-endpoint');
			const config = settingsStore.getProviderConfig(providerId);
			const currentTemplate = provider?.endpointTemplates?.find(t => t.id === config.endpointTemplate);
			if (currentTemplate && currentTemplate.id !== 'custom' && baseUrl !== currentTemplate.baseUrl) {
				settingsStore.setProviderConfig(providerId, {
					endpointTemplate: 'custom' as import('$lib/types').CustomEndpointTemplate,
					baseUrl
				});
				modulesStore.setModuleSetting('consciousness', 'endpointTemplate', 'custom');
			}
			if (baseUrl) debouncedFetchLLMModels(providerId);
		}
	}

	function handleLLMModelChange(modelId: string) {
		modulesStore.setModuleSetting('consciousness', 'activeModel', modelId);
	}

	const contextSizeSteps = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];

	function formatContextSize(value: number): string {
		if (value >= 1024) return `${value / 1024}k`;
		return String(value);
	}

	function handleContextSizeChange(value: number) {
		modulesStore.setModuleSetting('consciousness', 'contextSize', value);
	}

	function handleLLMParamChange(
		key: 'llmTemperature' | 'llmTopP' | 'llmMaxTokens' | 'llmPresencePenalty' | 'llmFrequencyPenalty',
		value: number | undefined
	) {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;
		settingsStore.setProviderConfig(providerId, { [key]: value });
	}

	function handleApiKeyChange(providerId: string, apiKey: string) {
		llmFetchError = null;
		settingsStore.setProviderConfig(providerId, { apiKey });
		if (apiKey) {
			settingsStore.markProviderAdded(providerId);
		}
	}

	function handleLLMApiKeyBlur() {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;
		const config = settingsStore.getProviderConfig(providerId);
		if (config.apiKey && (providerId !== 'custom-endpoint' || config.baseUrl)) {
			debouncedFetchLLMModels();
		}
	}

	function toggleLLM() {
		modulesStore.setModuleEnabled('consciousness', !isLLMEnabled);
	}
</script>

<div class="page">
	<header class="page-header">
		<h2>LLM Model</h2>
		<p>Configure the chat language model provider and parameters.</p>
	</header>

	<div class="sections">
		<section class="section">
			<div class="service-group">
				<div class="service-header">
					<Icon name="brain" size={14} />
					<span>Chat (LLM)</span>
					<button class="service-toggle" class:enabled={isLLMEnabled} onclick={toggleLLM} aria-label="Toggle LLM">
						<span class="toggle-track">
							<span class="toggle-thumb"></span>
						</span>
					</button>
				</div>

				{#if isLLMEnabled}
					<ProviderDropdown
						type="llm"
						value={consciousnessSettings.activeProvider as string}
						onSelect={handleLLMProviderChange}
						placeholder="Select LLM provider..."
					/>

					{#if consciousnessSettings.activeProvider}
						{@const provider = getLLMProvider(consciousnessSettings.activeProvider as string)}
						{#if provider}
							<!-- API Key (required for cloud providers, optional for custom endpoint) -->
							{#if provider.id !== 'custom-endpoint'}
								<div class="api-key-row">
									<input
										type="password"
										class="api-key-input"
										class:error={llmFetchError}
										placeholder="API Key"
										value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
										oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value)}
										onblur={handleLLMApiKeyBlur}
									/>
								</div>
							{/if}

							<!-- Custom endpoint template, base URL and optional key -->
							{#if provider.id === 'custom-endpoint'}
								<div class="api-key-row">
									<select
										class="api-key-input"
										value={settingsStore.getProviderConfig(provider.id).endpointTemplate ?? 'custom'}
										onchange={(e) => handleLLMEndpointTemplateChange(e.currentTarget.value)}
									>
										{#each provider.endpointTemplates ?? [] as template}
											<option value={template.id}>{template.name}</option>
										{/each}
									</select>
								</div>
								<div class="api-key-row">
									<input
										type="text"
										class="api-key-input"
										class:error={llmFetchError}
										placeholder="https://your-endpoint.com/v1"
										value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
										oninput={(e) => handleLLMBaseUrlChange(e.currentTarget.value)}
									/>
								</div>
								<div class="api-key-row">
									<input
										type="password"
										class="api-key-input"
										placeholder="API Key (optional)"
										value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
										oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value)}
										onblur={handleLLMApiKeyBlur}
									/>
								</div>

								<!-- Custom endpoint help -->
								<details class="custom-endpoint-help">
									<summary>How to configure this endpoint</summary>
									<div class="custom-endpoint-help-content">
										<p>{provider.endpointTemplates?.find(t => t.id === (settingsStore.getProviderConfig(provider.id).endpointTemplate ?? 'custom'))?.docsHint}</p>
										<ul>
											<li><strong>Google Gemini:</strong> set Base URL to <code>https://generativelanguage.googleapis.com/v1beta/openai/</code> and use a Google AI Studio API key. Enter the model ID manually (e.g. <code>gemini-1.5-flash-latest</code>).</li>
											<li><strong>DeepSeek / xAI:</strong> use their OpenAI-compatible base URL and API key, then enter the model ID manually.</li>
											<li><strong>Ollama:</strong> run <code>ollama serve</code>, pull a model with <code>ollama pull &lt;model&gt;</code>, and use <code>http://localhost:11434/v1/</code>.</li>
											<li><strong>LM Studio:</strong> start the developer server and use <code>http://localhost:1234/v1/</code>.</li>
											<li><strong>llama.cpp:</strong> start the server with <code>llama-server --model &lt;model.gguf&gt;</code> and use <code>http://localhost:8080/v1/</code>.</li>
										</ul>
									</div>
								</details>
							{/if}

							<!-- Model selection -->
							{#if provider.id !== 'custom-endpoint'}
								<ModelDropdown
									models={llmModels}
									value={consciousnessSettings.activeModel as string}
									onSelect={handleLLMModelChange}
									placeholder="Select model..."
									isLoading={llmIsLoading}
									onRefresh={() => fetchLLMModels(provider.id, true)}
									disabled={!llmIsReady}
									disabledMessage="Enter API key first"
								/>
							{:else}
								<ModelDropdown
									models={llmModels}
									value={consciousnessSettings.activeModel as string}
									onSelect={handleLLMModelChange}
									placeholder="Select or type model..."
									isLoading={llmIsLoading}
									onRefresh={() => fetchLLMModels(provider.id, true)}
									disabled={!llmIsReady}
									disabledMessage="Enter base URL first"
								/>
								<div class="api-key-row">
									<input
										type="text"
										class="api-key-input"
										placeholder="Model ID (e.g. llama3.2:latest)"
										value={consciousnessSettings.activeModel as string ?? ''}
										onchange={(e) => handleLLMModelChange(e.currentTarget.value)}
									/>
								</div>
							{/if}
							{#if llmFetchError}
								<p class="provider-note error">{llmFetchError}</p>
							{/if}
						{/if}
					{/if}

					<!-- Context Window -->
					<div class="api-key-row context-size-row">
						<label class="context-size-label" for="ps-llm-context-size">
							Context Window
							<span class="context-size-value">{formatContextSize((consciousnessSettings.contextSize as number) || 32768)}</span>
						</label>
						<input
							id="ps-llm-context-size"
							type="range"
							class="context-size-slider"
							min="0"
							max="7"
							step="1"
							value={contextSizeSteps.indexOf((consciousnessSettings.contextSize as number) || 32768)}
							oninput={(e) => handleContextSizeChange(contextSizeSteps[Number(e.currentTarget.value)])}
						/>
						<div class="context-size-ticks">
							{#each contextSizeSteps as step}
								<span>{formatContextSize(step)}</span>
							{/each}
						</div>
						<p class="provider-note">Maximum context size of the selected model. Used to scale memory injection.</p>
					</div>

					<!-- NSFW Mode Toggle -->
					<div class="nsfw-mode-row">
						<label class="nsfw-mode-label">
							<input
								type="checkbox"
								checked={!!consciousnessSettings.nsfwMode}
								onchange={(e) => modulesStore.setModuleSettings('consciousness', { ...consciousnessSettings, nsfwMode: e.currentTarget.checked })}
							/>
							Unfiltered Mode (NSFW)
						</label>
						<p class="provider-note">Injects a preamble instructing the LLM to write uncensored, immersive prose without moralizing or content filtering. Use only with local or uncensored models.</p>
					</div>

					<!-- Advanced LLM Parameters -->
					<details class="llm-advanced-params">
						<summary>Advanced Parameters</summary>
						<div class="llm-param-grid">
							<div class="llm-param-row">
								<label class="llm-param-label" for="ps-llm-temperature">
									Temperature
									<span class="llm-param-value">{(settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmTemperature ?? 0.7).toFixed(2)}</span>
								</label>
								<input
									id="ps-llm-temperature"
									type="range"
									class="llm-param-slider"
									min="0"
									max="2"
									step="0.05"
									value={settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmTemperature ?? 0.7}
									oninput={(e) => handleLLMParamChange('llmTemperature', Number(e.currentTarget.value))}
								/>
								<p class="provider-note">Controls randomness: 0 = focused/repetitive, 2 = highly creative/unpredictable. Default: 0.7</p>
							</div>

							<div class="llm-param-row">
								<label class="llm-param-label" for="ps-llm-top-p">
									Top-P
									<span class="llm-param-value">{(settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmTopP ?? 1).toFixed(2)}</span>
								</label>
								<input
									id="ps-llm-top-p"
									type="range"
									class="llm-param-slider"
									min="0"
									max="1"
									step="0.05"
									value={settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmTopP ?? 1}
									oninput={(e) => handleLLMParamChange('llmTopP', Number(e.currentTarget.value))}
								/>
								<p class="provider-note">Nucleus sampling: only consider tokens whose cumulative probability reaches this value. 1 = disabled. Default: 1.0</p>
							</div>

							<div class="llm-param-row">
								<label class="llm-param-label" for="ps-llm-max-tokens">
									Max Tokens
									<span class="llm-param-value">{settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmMaxTokens ?? '—'}</span>
								</label>
								<input
									id="ps-llm-max-tokens"
									type="number"
									class="api-key-input"
									min="1"
									max="32768"
									step="1"
									placeholder="Unlimited"
									value={settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmMaxTokens ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value;
										handleLLMParamChange('llmMaxTokens', val ? Number(val) : undefined);
									}}
								/>
								<p class="provider-note">Hard limit for the number of tokens in the response. Leave empty to use the provider default.</p>
							</div>

							<div class="llm-param-row">
								<label class="llm-param-label" for="ps-llm-presence-penalty">
									Presence Penalty
									<span class="llm-param-value">{(settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmPresencePenalty ?? 0).toFixed(1)}</span>
								</label>
								<input
									id="ps-llm-presence-penalty"
									type="range"
									class="llm-param-slider"
									min="-2"
									max="2"
									step="0.1"
									value={settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmPresencePenalty ?? 0}
									oninput={(e) => handleLLMParamChange('llmPresencePenalty', Number(e.currentTarget.value))}
								/>
								<p class="provider-note">Penalizes tokens that have already appeared in the text, regardless of how often. Positive values reduce repetition. Default: 0</p>
							</div>

							<div class="llm-param-row">
								<label class="llm-param-label" for="ps-llm-frequency-penalty">
									Frequency Penalty
									<span class="llm-param-value">{(settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmFrequencyPenalty ?? 0).toFixed(1)}</span>
								</label>
								<input
									id="ps-llm-frequency-penalty"
									type="range"
									class="llm-param-slider"
									min="-2"
									max="2"
									step="0.1"
									value={settingsStore.getProviderConfig((consciousnessSettings.activeProvider as string) || 'openai').llmFrequencyPenalty ?? 0}
									oninput={(e) => handleLLMParamChange('llmFrequencyPenalty', Number(e.currentTarget.value))}
								/>
								<p class="provider-note">Penalizes tokens based on how often they have already appeared. Higher values reduce repetition more strongly. Default: 0</p>
							</div>
						</div>
					</details>
				{/if}
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

	.service-toggle {
		margin-left: auto;
		position: relative;
		width: 40px;
		height: 22px;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.toggle-track {
		display: block;
		width: 100%;
		height: 100%;
		background: linear-gradient(180deg, #d0d0d0 0%, #e0e0e0 100%);
		border-radius: 11px;
		transition: all 0.2s ease-out;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.15),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .toggle-track {
		background: linear-gradient(180deg, #1a1a1a 0%, #252525 100%);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.service-toggle.enabled .toggle-track {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.8),
			0 2px 8px rgba(1, 178, 255, 0.3);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border-radius: 50%;
		transition: transform 0.2s ease-out;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	.service-toggle.enabled .toggle-thumb {
		transform: translateX(18px);
	}

	.api-key-row {
		display: flex;
		gap: 0.5rem;
	}

	.provider-note {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.provider-note.error {
		color: var(--color-error);
	}

	.context-size-row {
		flex-direction: column;
		align-items: stretch;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}

	.context-size-label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.context-size-value {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.context-size-slider {
		width: 100%;
		cursor: pointer;
	}

	.context-size-ticks {
		display: flex;
		justify-content: space-between;
		font-size: 0.65rem;
		color: var(--text-tertiary);
		padding: 0 0.25rem;
	}

	.custom-endpoint-help {
		font-size: 0.8rem;
		color: var(--text-secondary);
		background: rgba(0, 0, 0, 0.03);
		border-radius: 10px;
		padding: 0.5rem 0.75rem;
		margin-top: 0.25rem;
	}

	:global(.dark) .custom-endpoint-help {
		background: rgba(255, 255, 255, 0.05);
	}

	.custom-endpoint-help summary {
		cursor: pointer;
		font-weight: 600;
	}

	.custom-endpoint-help-content {
		margin-top: 0.5rem;
		line-height: 1.5;
	}

	.custom-endpoint-help-content p {
		margin: 0 0 0.5rem;
	}

	.custom-endpoint-help-content ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.custom-endpoint-help-content li {
		margin-bottom: 0.35rem;
	}

	.custom-endpoint-help-content code {
		font-family: 'Share Tech Mono', monospace;
		font-size: 0.75rem;
		background: rgba(0, 0, 0, 0.06);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
	}

	:global(.dark) .custom-endpoint-help-content code {
		background: rgba(255, 255, 255, 0.08);
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

	select.api-key-input {
		appearance: none;
		-webkit-appearance: none;
		background-clip: padding-box;
		cursor: pointer;
		padding-right: 2rem;
	}

	select.api-key-input option {
		color: var(--text-primary);
		background: var(--bg-secondary);
	}

	:global(.dark) .api-key-input {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.03);
	}

	:global(.dark) select.api-key-input option {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.api-key-input:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			0 0 0 3px rgba(1, 178, 255, 0.15),
			inset 0 1px 3px rgba(0, 0, 0, 0.06);
	}

	.api-key-input.error {
		border-color: var(--color-error);
		animation: shake 0.4s ease-out;
	}

	.nsfw-mode-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}

	.nsfw-mode-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.nsfw-mode-label input[type='checkbox'] {
		accent-color: #01B2FF;
		cursor: pointer;
	}

	.llm-advanced-params {
		margin-top: 0.75rem;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 0.5rem;
		padding: 0.75rem;
		background: rgba(0, 0, 0, 0.02);
	}

	:global(.dark) .llm-advanced-params {
		border-color: rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
	}

	.llm-advanced-params summary {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		user-select: none;
	}

	.llm-param-grid {
		margin-top: 0.75rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}

	.llm-param-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.llm-param-label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.llm-param-value {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.llm-param-slider {
		width: 100%;
		cursor: pointer;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-4px); }
		40% { transform: translateX(4px); }
		60% { transform: translateX(-3px); }
		80% { transform: translateX(2px); }
	}
</style>

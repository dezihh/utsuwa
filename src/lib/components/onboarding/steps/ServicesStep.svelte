<script lang="ts">
	import { Icon, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getLLMProvider, getTTSProvider } from '$lib/services/providers/registry';
	import {
		fetchModels,
		getCachedModelsForProvider,
		debounce,
		type ModelInfo
	} from '$lib/services/providers/use-model-fetch';
	import { fetchAllTalkData, type AllTalkOption } from '$lib/services/providers/alltalk';
	import { fetchChatterboxVoices, type ChatterboxVoice } from '$lib/services/providers/chatterbox';

	interface Props {
		onNext: () => void;
		onBack: () => void;
	}

	let { onNext, onBack }: Props = $props();

	// LLM State
	const llmSettings = $derived(modulesStore.getModuleSettings('consciousness'));
	const llmProvider = $derived(getLLMProvider(llmSettings.activeProvider as string));
	const staticLLMModels = $derived(llmProvider?.models ?? []);

	// Dynamic model fetching state for LLM
	let llmIsLoading = $state(false);
	let llmFetchError = $state<string | null>(null);
	let llmDynamicModels = $state<ModelInfo[] | null>(null);

	// Use dynamic models if available, otherwise static
	const llmModels = $derived(llmDynamicModels ?? staticLLMModels);

	// Check if provider is ready to fetch models
	const llmIsReady = $derived.by(() => {
		if (!llmProvider) return false;
		const config = settingsStore.getProviderConfig(llmProvider.id);
		if (llmProvider.id === 'custom-endpoint') {
			return !!config.baseUrl;
		}
		return !!config.apiKey;
	});

	// TTS State
	let ttsEnabled = $state(false);
	const ttsSettings = $derived(modulesStore.getModuleSettings('speech'));
	const ttsProvider = $derived(getTTSProvider(ttsSettings.activeProvider as string));
	const staticTTSModels = $derived(ttsProvider?.models ?? []);

	// Dynamic model fetching state for TTS
	let ttsIsLoading = $state(false);
	let ttsFetchError = $state<string | null>(null);
	let ttsDynamicModels = $state<ModelInfo[] | null>(null);
	let alltalkIsLoading = $state(false);
	let alltalkFetchError = $state<string | null>(null);
	let alltalkReady = $state(false);
	let alltalkVoices = $state<AllTalkOption[]>([]);
	let alltalkRvcVoices = $state<AllTalkOption[]>([]);
	let lastAllTalkFetchSignature = '';

	let chatterboxVoices = $state<ChatterboxVoice[]>([]);
	let chatterboxIsLoading = $state(false);
	let chatterboxFetchError = $state<string | null>(null);
	let lastChatterboxFetchSignature = '';

	// Use dynamic models if available, otherwise static
	const ttsModels = $derived(ttsDynamicModels ?? staticTTSModels);

	// Check if API key is present for current TTS provider
	const ttsHasApiKey = $derived.by(() => {
		if (!ttsProvider) return false;
		if (ttsProvider.isLocal || !ttsProvider.requiresApiKey) return true;
		const config = settingsStore.getProviderConfig(ttsProvider.id);
		return !!config.apiKey;
	});

	function withSelectedOption(options: AllTalkOption[], selected: string, fallbackLabel: string): AllTalkOption[] {
		if (!selected) return options;
		if (options.some((option) => option.id === selected)) return options;
		return [{ id: selected, name: fallbackLabel }, ...options];
	}

	const alltalkVoiceOptions = $derived.by(() =>
		withSelectedOption(alltalkVoices, ttsSettings.activeVoiceId as string, 'Current voice')
	);

	const alltalkRvcVoiceOptions = $derived.by(() =>
		withSelectedOption(alltalkRvcVoices, ttsSettings.activeRvcVoiceId as string, 'Current RVC voice')
	);

	// Validation
	const isLLMConfigured = $derived.by(() => {
		if (!llmSettings.activeProvider) return false;
		const provider = getLLMProvider(llmSettings.activeProvider as string);
		if (!provider) return false;
		if (provider.id === 'custom-endpoint') {
			const activeModel = llmSettings.activeModel as string;
			return !!activeModel && !!settingsStore.getProviderConfig(provider.id).baseUrl;
		}
		const config = settingsStore.getProviderConfig(provider.id);
		return !!config.apiKey && !!llmSettings.activeModel;
	});

	// Fetch LLM models from provider API
	async function fetchLLMModels(targetProvider = llmProvider?.id, forceRefresh = false) {
		if (!targetProvider) return;

		const config = settingsStore.getProviderConfig(targetProvider);
		const provider = getLLMProvider(targetProvider);

		if (forceRefresh) {
			settingsStore.clearCachedModels(targetProvider);
		} else {
			const cached = getCachedModelsForProvider(targetProvider);
			if (cached) {
				llmDynamicModels = cached;
				return;
			}
		}

		await fetchModels({
			providerId: targetProvider,
			apiKey: config.apiKey ?? '',
			baseUrl: config.baseUrl,
			isLocal: provider?.id === 'custom-endpoint',
			getCurrentProviderId: () => modulesStore.getModuleSettings('consciousness').activeProvider as string,
			onStart: () => {
				llmIsLoading = true;
				llmFetchError = null;
			},
			onSuccess: (models) => {
				llmIsLoading = false;
				llmDynamicModels = models;
				const currentModel = llmSettings.activeModel as string;
				const modelExists = models.some((m) => m.id === currentModel);
				if (!currentModel || !modelExists) {
					modulesStore.setModuleSetting('consciousness', 'activeModel', models[0].id);
				}
			},
			onError: (error) => {
				llmIsLoading = false;
				llmFetchError = error;
				llmDynamicModels = provider?.id === 'custom-endpoint' ? [] : null;
			},
			onEmpty: () => {
				llmIsLoading = false;
				llmFetchError = provider?.id === 'custom-endpoint' ? 'No models found' : 'Using default list';
				llmDynamicModels = provider?.id === 'custom-endpoint' ? [] : null;
			},
			onStale: () => {
				llmIsLoading = false;
			}
		});
	}

	// Fetch TTS models from provider API
	async function fetchTTSModels() {
		const targetProvider = ttsProvider?.id;
		if (!targetProvider) return;

		const config = settingsStore.getProviderConfig(targetProvider);
		const provider = getTTSProvider(targetProvider);

		await fetchModels({
			providerId: targetProvider,
			apiKey: config.apiKey ?? '',
			baseUrl: config.baseUrl,
			isLocal: provider?.isLocal,
			getCurrentProviderId: () => modulesStore.getModuleSettings('speech').activeProvider as string,
			onStart: () => {
				ttsIsLoading = true;
				ttsFetchError = null;
			},
			onSuccess: (models) => {
				ttsIsLoading = false;
				ttsDynamicModels = models;
				// Auto-select first model if none selected
				if (!ttsSettings.activeModel && models.length > 0) {
					modulesStore.setModuleSetting('speech', 'activeModel', models[0].id);
				}
			},
			onError: (error) => {
				ttsIsLoading = false;
				ttsFetchError = error;
				ttsDynamicModels = null;
			},
			onEmpty: () => {
				ttsIsLoading = false;
				ttsDynamicModels = null;
			},
			onStale: () => {
				ttsIsLoading = false;
			}
		});
	}

	async function fetchAllTalkSettings() {
		if (ttsProvider?.id !== 'alltalk') return;

		const config = settingsStore.getProviderConfig('alltalk');

		alltalkIsLoading = true;
		alltalkFetchError = null;

		const result = await fetchAllTalkData(config.baseUrl, config.apiKey);
		if (ttsProvider?.id !== 'alltalk') {
			alltalkIsLoading = false;
			return;
		}

		alltalkIsLoading = false;
		alltalkReady = result.ready;
		alltalkVoices = result.voices;
		alltalkRvcVoices = result.rvcVoices;
		alltalkFetchError = result.error ?? null;

		if (!result.error) {
			if (!ttsSettings.activeVoiceId && result.defaultVoiceId) {
				modulesStore.setModuleSetting('speech', 'activeVoiceId', result.defaultVoiceId);
			} else if (!ttsSettings.activeVoiceId && result.voices[0]?.id) {
				modulesStore.setModuleSetting('speech', 'activeVoiceId', result.voices[0].id);
			}
			if (!ttsSettings.activeRvcVoiceId && result.defaultRvcVoiceId) {
				modulesStore.setModuleSetting('speech', 'activeRvcVoiceId', result.defaultRvcVoiceId);
			} else if (!ttsSettings.activeRvcVoiceId && result.rvcVoices[0]?.id) {
				modulesStore.setModuleSetting('speech', 'activeRvcVoiceId', result.rvcVoices[0].id);
			}
		}
	}

	// Debounced fetch to avoid rapid API calls
	const debouncedFetchLLMModels = debounce(fetchLLMModels, 300);
	const debouncedFetchTTSModels = debounce(fetchTTSModels, 300);
	const debouncedFetchAllTalkSettings = debounce(fetchAllTalkSettings, 300);

	async function loadChatterboxVoices() {
		if (ttsProvider?.id !== 'chatterbox') return;
		const config = settingsStore.getProviderConfig('chatterbox');
		chatterboxIsLoading = true;
		chatterboxFetchError = null;
		const result = await fetchChatterboxVoices(config.baseUrl);
		if (ttsProvider?.id !== 'chatterbox') { chatterboxIsLoading = false; return; }
		chatterboxIsLoading = false;
		chatterboxVoices = result.voices;
		chatterboxFetchError = result.error ?? null;
		if (!result.error && result.voices.length > 0 && !ttsSettings.activeVoiceId) {
			modulesStore.setModuleSetting('speech', 'activeVoiceId', result.voices[0].id);
		}
	}

	const debouncedLoadChatterboxVoices = debounce(loadChatterboxVoices, 300);

	$effect(() => {
		const targetProvider = ttsSettings.activeProvider as string;
		if (targetProvider !== 'chatterbox') {
			lastChatterboxFetchSignature = '';
			return;
		}
		const config = settingsStore.getProviderConfig('chatterbox');
		const signature = `chatterbox::${config.baseUrl ?? ''}`;
		if (signature === lastChatterboxFetchSignature) return;
		lastChatterboxFetchSignature = signature;
		debouncedLoadChatterboxVoices();
	});

	$effect(() => {
		const targetProvider = ttsSettings.activeProvider as string;
		if (targetProvider !== 'alltalk') {
			lastAllTalkFetchSignature = '';
			return;
		}

		const config = settingsStore.getProviderConfig('alltalk');
		const signature = `${targetProvider}::${config.baseUrl ?? ''}::${config.apiKey ?? ''}`;
		if (signature === lastAllTalkFetchSignature) return;

		lastAllTalkFetchSignature = signature;
		debouncedFetchAllTalkSettings();
	});

	// Load models for the active LLM provider on mount/provider change.
	$effect(() => {
		const providerId = llmSettings.activeProvider as string;
		if (!providerId) return;

		if (llmDynamicModels !== null) return;

		const cached = getCachedModelsForProvider(providerId);
		if (cached) {
			llmDynamicModels = cached;
			return;
		}

		const provider = getLLMProvider(providerId);
		const config = settingsStore.getProviderConfig(providerId);
		if (provider?.id === 'custom-endpoint') {
			if (config.baseUrl) debouncedFetchLLMModels(providerId);
		} else if (config.apiKey) {
			debouncedFetchLLMModels(providerId);
		}
	});

	// Handlers
	function handleLLMProviderChange(providerId: string) {
		modulesStore.setModuleSetting('consciousness', 'activeProvider', providerId);
		const provider = getLLMProvider(providerId);

		// Reset dynamic models when provider changes
		llmDynamicModels = null;
		llmFetchError = null;
		llmIsLoading = false;

		if (provider) {
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

	function handleLLMModelChange(modelId: string) {
		modulesStore.setModuleSetting('consciousness', 'activeModel', modelId);
	}

	function handleLLMBaseUrlChange(baseUrl: string) {
		if (llmProvider) {
			llmFetchError = null;
			settingsStore.setProviderConfig(llmProvider.id, { baseUrl });

			// If the user edits the URL away from the selected preset, switch to custom mode.
			if (llmProvider.id === 'custom-endpoint') {
				const provider = getLLMProvider('custom-endpoint');
				const config = settingsStore.getProviderConfig(llmProvider.id);
				const currentTemplate = provider?.endpointTemplates?.find(t => t.id === config.endpointTemplate);
				if (currentTemplate && currentTemplate.id !== 'custom' && baseUrl !== currentTemplate.baseUrl) {
					settingsStore.setProviderConfig(llmProvider.id, {
						endpointTemplate: 'custom' as import('$lib/types').CustomEndpointTemplate,
						baseUrl
					});
					modulesStore.setModuleSetting('consciousness', 'endpointTemplate', 'custom');
				}
				if (baseUrl) debouncedFetchLLMModels(llmProvider.id);
			}
		}
	}

	function handleLLMApiKeyChange(apiKey: string) {
		if (llmProvider) {
			llmFetchError = null; // Clear error when user types
			settingsStore.setProviderConfig(llmProvider.id, { apiKey });
			if (apiKey) {
				settingsStore.markProviderAdded(llmProvider.id);
			}
		}
	}

	function handleLLMApiKeyBlur() {
		if (!llmProvider) return;
		const config = settingsStore.getProviderConfig(llmProvider.id);
		if (config.apiKey && (llmProvider.id !== 'custom-endpoint' || config.baseUrl)) {
			debouncedFetchLLMModels();
		}
	}

	function handleTTSProviderChange(providerId: string) {
		modulesStore.setModuleSetting('speech', 'activeProvider', providerId);
		const provider = getTTSProvider(providerId);

		// Reset dynamic models when provider changes
		ttsDynamicModels = null;
		ttsFetchError = null;
		ttsIsLoading = false;

		// Check for cached models
		const cached = getCachedModelsForProvider(providerId);
		if (cached) {
			ttsDynamicModels = cached;
		}

		if (provider?.models?.length) {
			modulesStore.setModuleSetting('speech', 'activeModel', provider.models[0].id);
		}
		if (providerId === 'alltalk') {
			// effect handles AllTalk refresh
		}
		// Local providers ship a default voice so requests work before the user picks one
		if (provider?.isLocal && provider.voices?.length) {
			modulesStore.setModuleSetting('speech', 'activeVoiceId', provider.voices[0].id);
		}
		// Mark local providers as added immediately (they don't need API keys)
		if (provider?.isLocal || !provider?.requiresApiKey) {
			settingsStore.markProviderAdded(providerId);
		}
	}

	function handleTTSModelChange(modelId: string) {
		modulesStore.setModuleSetting('speech', 'activeModel', modelId);
	}

	function handleTTSApiKeyChange(apiKey: string) {
		if (ttsProvider) {
			ttsFetchError = null; // Clear error when user types
			settingsStore.setProviderConfig(ttsProvider.id, { apiKey });
			if (ttsProvider.id === 'alltalk') {
				debouncedFetchAllTalkSettings();
			}
			if (apiKey) {
				settingsStore.markProviderAdded(ttsProvider.id);
			}
		}
	}

	function handleTTSApiKeyBlur() {
		const config = settingsStore.getProviderConfig(ttsProvider?.id ?? '');
		if (config.apiKey && ttsProvider && !ttsProvider.isLocal) {
			debouncedFetchTTSModels();
		}
	}

	function handleTTSBaseUrlChange(baseUrl: string) {
		if (ttsProvider) {
			settingsStore.setProviderConfig(ttsProvider.id, { baseUrl });
			if (ttsProvider.id === 'alltalk') {
				debouncedFetchAllTalkSettings();
			}
			if (ttsProvider.id === 'chatterbox') {
				debouncedLoadChatterboxVoices();
			}
		}
	}

	function handleAllTalkVoiceChange(voiceId: string) {
		modulesStore.setModuleSetting('speech', 'activeVoiceId', voiceId);
	}

	function handleAllTalkRvcVoiceChange(voiceId: string) {
		modulesStore.setModuleSetting('speech', 'activeRvcVoiceId', voiceId);
	}

	function handleChatterboxVoiceChange(voiceId: string) {
		modulesStore.setModuleSetting('speech', 'activeVoiceId', voiceId);
	}

	function handleChatterboxParamChange(key: 'exaggeration' | 'cfgWeight' | 'temperature', value: number) {
		settingsStore.setProviderConfig('chatterbox', { [key]: value });
	}

	function handleChatterboxLanguageChange(language: string) {
		settingsStore.setProviderConfig('chatterbox', { language: language || undefined });
	}

	function handleNext() {
		modulesStore.setModuleEnabled('consciousness', true);
		if (ttsEnabled && ttsSettings.activeProvider) {
			modulesStore.setModuleEnabled('speech', true);
		}
		onNext();
	}
</script>

<div class="ob-step services-step">
	<div class="ob-head">
		<h2 class="ob-title">Configure AI services</h2>
		<p class="ob-subtitle">Set up your LLM for chat (required) and TTS for speech (optional).</p>
	</div>

	<div class="security-note">
		<Icon name="lock" size={14} />
		<span>Your API keys are stored locally in your browser. We never store them on our servers.</span>
	</div>

	<!-- LLM Section -->
	<div class="service-section">
		<div class="service-header">
			<Icon name="brain" size={16} />
			<span class="service-title">Chat (LLM)</span>
			<span class="required-badge">Required</span>
		</div>

		<ProviderDropdown
			type="llm"
			value={llmSettings.activeProvider as string}
			onSelect={handleLLMProviderChange}
			placeholder="Select LLM provider..."
		/>

		{#if llmProvider}
			{#if llmProvider.id !== 'custom-endpoint'}
				<input
					type="password"
					class="api-key-input"
					class:error={llmFetchError}
					placeholder="Enter API Key..."
					value={settingsStore.getProviderConfig(llmProvider.id).apiKey ?? ''}
					oninput={(e) => handleLLMApiKeyChange(e.currentTarget.value)}
					onblur={handleLLMApiKeyBlur}
				/>
			{/if}

			{#if llmProvider.id === 'custom-endpoint'}
				<select
					class="api-key-input"
					value={settingsStore.getProviderConfig(llmProvider.id).endpointTemplate ?? 'custom'}
					onchange={(e) => handleLLMEndpointTemplateChange(e.currentTarget.value)}
				>
					{#each llmProvider.endpointTemplates ?? [] as template}
						<option value={template.id}>{template.name}</option>
					{/each}
				</select>
				<input
					type="text"
					class="api-key-input"
					class:error={llmFetchError}
					placeholder="https://your-endpoint.com/v1"
					value={settingsStore.getProviderConfig(llmProvider.id).baseUrl ?? ''}
					oninput={(e) => handleLLMBaseUrlChange(e.currentTarget.value)}
				/>
				<input
					type="password"
					class="api-key-input"
					placeholder="API Key (optional)"
					value={settingsStore.getProviderConfig(llmProvider.id).apiKey ?? ''}
					oninput={(e) => handleLLMApiKeyChange(e.currentTarget.value)}
					onblur={handleLLMApiKeyBlur}
				/>
				<details class="custom-endpoint-help">
					<summary>How to configure this endpoint</summary>
					<div class="custom-endpoint-help-content">
						<p>{llmProvider.endpointTemplates?.find(t => t.id === (settingsStore.getProviderConfig(llmProvider.id).endpointTemplate ?? 'custom'))?.docsHint}</p>
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

			{#if llmProvider.id !== 'custom-endpoint'}
				<ModelDropdown
					models={llmModels}
					value={llmSettings.activeModel as string}
					onSelect={handleLLMModelChange}
					placeholder="Select model..."
					isLoading={llmIsLoading}
					onRefresh={() => fetchLLMModels(llmProvider.id, true)}
					disabled={!llmIsReady}
					disabledMessage="Enter API key first"
				/>
			{:else}
				<ModelDropdown
					models={llmModels}
					value={llmSettings.activeModel as string}
					onSelect={handleLLMModelChange}
					placeholder="Select or type model..."
					isLoading={llmIsLoading}
					onRefresh={() => fetchLLMModels(llmProvider.id, true)}
					disabled={!llmIsReady}
					disabledMessage="Enter base URL first"
				/>
				<input
					type="text"
					class="api-key-input"
					placeholder="Model ID (e.g. llama3.2:latest)"
					value={llmSettings.activeModel as string ?? ''}
					oninput={(e) => handleLLMModelChange(e.currentTarget.value)}
				/>
			{/if}
			{#if llmFetchError}
				<p class="provider-note error">{llmFetchError}</p>
			{/if}
		{/if}
	</div>

	<!-- TTS Section -->
	<div class="service-section">
		<div class="service-header">
			<Icon name="mic" size={16} />
			<span class="service-title">Speech (TTS)</span>
			<span class="optional-badge">Optional</span>
			<button class="toggle-btn" class:enabled={ttsEnabled} onclick={() => ttsEnabled = !ttsEnabled} aria-label="Toggle TTS">
				<span class="toggle-track">
					<span class="toggle-thumb"></span>
				</span>
			</button>
		</div>

		{#if ttsEnabled}
			<ProviderDropdown
				type="tts"
				value={ttsSettings.activeProvider as string}
				onSelect={handleTTSProviderChange}
				placeholder="Select TTS provider..."
			/>

			{#if ttsProvider?.requiresApiKey}
				<input
					type="password"
					class="api-key-input"
					class:error={ttsFetchError}
					placeholder="Enter API Key..."
					value={settingsStore.getProviderConfig(ttsProvider.id).apiKey ?? ''}
					oninput={(e) => handleTTSApiKeyChange(e.currentTarget.value)}
					onblur={handleTTSApiKeyBlur}
				/>
			{/if}

			{#if ttsProvider?.id === 'alltalk'}
				<input
					type="password"
					class="api-key-input"
					class:error={alltalkFetchError !== null}
					placeholder="Auth token (optional)"
					value={settingsStore.getProviderConfig(ttsProvider.id).apiKey ?? ''}
					oninput={(e) => handleTTSApiKeyChange(e.currentTarget.value)}
					onblur={handleTTSApiKeyBlur}
				/>
			{/if}

			{#if ttsSettings.activeProvider && ttsProvider?.id !== 'alltalk' && !ttsProvider?.isLocal}
				<ModelDropdown
					models={ttsModels}
					value={ttsSettings.activeModel as string}
					onSelect={handleTTSModelChange}
					placeholder="Select model..."
					isLoading={ttsIsLoading}
					onRefresh={ttsHasApiKey ? fetchTTSModels : undefined}
					disabled={!ttsHasApiKey}
					disabledMessage="Enter API key first"
				/>
			{/if}

			{#if ttsProvider?.id === 'alltalk'}
				<select
					class="api-key-input"
					value={ttsSettings.activeVoiceId as string}
					onchange={(e) => handleAllTalkVoiceChange(e.currentTarget.value)}
					disabled={alltalkIsLoading}
				>
					<option value="">Select a voice...</option>
					{#each alltalkVoiceOptions as voice}
						<option value={voice.id}>{voice.name}</option>
					{/each}
				</select>
				{#if alltalkRvcVoiceOptions.length > 0}
					<select
						class="api-key-input"
						value={ttsSettings.activeRvcVoiceId as string}
						onchange={(e) => handleAllTalkRvcVoiceChange(e.currentTarget.value)}
						disabled={alltalkIsLoading}
					>
						<option value="">Select an RVC voice...</option>
						{#each alltalkRvcVoiceOptions as voice}
							<option value={voice.id}>{voice.name}</option>
						{/each}
					</select>
				{/if}
				<input
					type="text"
					class="api-key-input"
					class:error={!!alltalkFetchError}
					placeholder={getTTSProvider('alltalk')?.defaultBaseUrl || 'http://localhost:7851/api/'}
					value={settingsStore.getProviderConfig('alltalk').baseUrl ?? ''}
					oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
				/>
				{#if alltalkFetchError}
					<p class="provider-note error">{alltalkFetchError}</p>
				{:else}
					<p class="provider-note">
						<Icon name={alltalkReady ? 'check-circle' : 'alert-circle'} size={14} />
						{alltalkReady ? 'AllTalk is ready' : 'AllTalk status unknown'}
					</p>
				{/if}
			{/if}

			{#if ttsSettings.activeProvider === 'elevenlabs'}
				<input
					type="text"
					class="api-key-input"
					placeholder="Custom Voice ID (optional)"
					value={settingsStore.elevenLabsVoiceId}
					oninput={(e) => settingsStore.setElevenLabsVoiceId(e.currentTarget.value)}
				/>
			{/if}

			{#if ttsProvider?.isLocal && ttsProvider.id !== 'alltalk' && ttsProvider.id !== 'chatterbox' && ttsProvider.id !== 'omnivoice'}
				<input
					type="text"
					class="api-key-input"
					placeholder="Model/voice name"
					value={ttsSettings.activeModel as string ?? ''}
					oninput={(e) => handleTTSModelChange(e.currentTarget.value)}
				/>
			{/if}

			{#if ttsProvider?.isLocal && ttsProvider.id !== 'alltalk' && ttsProvider.id !== 'chatterbox' && ttsProvider.id !== 'omnivoice'}
				<input
					type="text"
					class="api-key-input"
					placeholder={ttsProvider.defaultBaseUrl || 'http://localhost:5000/'}
					value={settingsStore.getProviderConfig(ttsProvider.id).baseUrl ?? ''}
					oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
				/>
				<p class="provider-note">
					<Icon name="check-circle" size={14} />
					Local provider - no API key needed
				</p>
			{/if}

			{#if ttsProvider?.id === 'chatterbox'}
				<select
					class="api-key-input"
					value={ttsSettings.activeVoiceId as string ?? ''}
					onchange={(e) => handleChatterboxVoiceChange(e.currentTarget.value)}
					disabled={chatterboxIsLoading}
				>
					<option value="">
						{chatterboxIsLoading ? 'Loading voices...' : 'Select a voice...'}
					</option>
					{#each chatterboxVoices as voice}
						<option value={voice.id}>{voice.name}</option>
					{/each}
				</select>
				<input
					type="text"
					class="api-key-input"
					class:error={!!chatterboxFetchError}
					placeholder={getTTSProvider('chatterbox')?.defaultBaseUrl || 'http://localhost:8765/'}
					value={settingsStore.getProviderConfig('chatterbox').baseUrl ?? ''}
					oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
				/>
				{#if chatterboxFetchError}
					<p class="provider-note error">{chatterboxFetchError}</p>
				{:else}
					<p class="provider-note">
						<Icon name="check-circle" size={14} />
						Local provider - no API key needed
					</p>
				{/if}
				<!-- Language -->
				<div class="vad-sensitivity-row">
					<span class="vad-sensitivity-label">Language</span>
					<select
						class="api-key-input"
						value={settingsStore.getProviderConfig('chatterbox').language ?? ''}
						onchange={(e) => handleChatterboxLanguageChange(e.currentTarget.value)}
					>
						<option value="">Auto-detect</option>
						<option value="de">German (de)</option>
						<option value="en">English (en)</option>
						<option value="fr">French (fr)</option>
						<option value="es">Spanish (es)</option>
						<option value="it">Italian (it)</option>
						<option value="pt">Portuguese (pt)</option>
						<option value="nl">Dutch (nl)</option>
						<option value="pl">Polish (pl)</option>
						<option value="ru">Russian (ru)</option>
						<option value="zh">Chinese (zh)</option>
						<option value="ja">Japanese (ja)</option>
						<option value="ko">Korean (ko)</option>
					</select>
				</div>
				<!-- Exaggeration -->
				<div class="vad-sensitivity-row">
					<label class="vad-sensitivity-label" for="cb-exaggeration">
						Exaggeration
						<span class="vad-value">{(settingsStore.getProviderConfig('chatterbox').exaggeration ?? 0.5).toFixed(2)}</span>
					</label>
					<input
						id="cb-exaggeration"
						type="range"
						class="vad-slider"
						min="0"
						max="2"
						step="0.05"
						value={settingsStore.getProviderConfig('chatterbox').exaggeration ?? 0.5}
						oninput={(e) => handleChatterboxParamChange('exaggeration', Number(e.currentTarget.value))}
					/>
					<div class="vad-hint">Emotion intensity (0.0 = flat, 2.0 = very expressive). Default: 0.5</div>
				</div>
				<!-- CFG Weight -->
				<div class="vad-sensitivity-row">
					<label class="vad-sensitivity-label" for="cb-cfg-weight">
						CFG Weight
						<span class="vad-value">{(settingsStore.getProviderConfig('chatterbox').cfgWeight ?? 0.5).toFixed(2)}</span>
					</label>
					<input
						id="cb-cfg-weight"
						type="range"
						class="vad-slider"
						min="0"
						max="5"
						step="0.1"
						value={settingsStore.getProviderConfig('chatterbox').cfgWeight ?? 0.5}
						oninput={(e) => handleChatterboxParamChange('cfgWeight', Number(e.currentTarget.value))}
					/>
					<div class="vad-hint">Classifier-free guidance weight (0.0-5.0). Default: 0.5</div>
				</div>
				<!-- Temperature -->
				<div class="vad-sensitivity-row">
					<label class="vad-sensitivity-label" for="cb-temperature">
						Temperature
						<span class="vad-value">{(settingsStore.getProviderConfig('chatterbox').temperature ?? 0.8).toFixed(2)}</span>
					</label>
					<input
						id="cb-temperature"
						type="range"
						class="vad-slider"
						min="0.05"
						max="1"
						step="0.05"
						value={settingsStore.getProviderConfig('chatterbox').temperature ?? 0.8}
						oninput={(e) => handleChatterboxParamChange('temperature', Number(e.currentTarget.value))}
					/>
					<div class="vad-hint">Generation randomness (0.05 = deterministic, 1.0 = creative). Default: 0.8</div>
				</div>
			{/if}

			{#if ttsProvider?.id === 'omnivoice'}
				<!-- Voice selection (built-in voices) -->
				<select
					class="api-key-input"
					value={ttsSettings.activeVoiceId as string ?? 'female3'}
					onchange={(e) => {
						modulesStore.setModuleSetting('speech', 'activeVoiceId', e.currentTarget.value);
					}}
				>
					{#each (ttsProvider.voices ?? []) as voice}
						<option value={voice.id}>{voice.name}</option>
					{/each}
				</select>
				<!-- Base URL -->
				<input
					type="text"
					class="api-key-input"
					placeholder={ttsProvider.defaultBaseUrl || 'http://localhost:8766/'}
					value={settingsStore.getProviderConfig('omnivoice').baseUrl ?? ''}
					oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
				/>
				<p class="provider-note">
					<Icon name="check-circle" size={14} />
					Local provider - no API key needed
				</p>
				<!-- Diffusion steps -->
				<div class="vad-sensitivity-row">
					<label class="vad-sensitivity-label" for="ov-numstep">
						Quality
						<span class="vad-value"
							>{settingsStore.getProviderConfig('omnivoice').omnivoiceNumStep === 16
								? 'Fast (16)'
								: 'Quality (32)'}</span
						>
					</label>
					<select
						id="ov-numstep"
						class="api-key-input"
						value={String(settingsStore.getProviderConfig('omnivoice').omnivoiceNumStep ?? 32)}
						onchange={(e) =>
							settingsStore.setProviderConfig('omnivoice', {
								omnivoiceNumStep: Number(e.currentTarget.value)
							})}
					>
						<option value="32">Quality — 32 steps (RTF ~0.33)</option>
						<option value="16">Fast — 16 steps (RTF ~0.18)</option>
					</select>
					<div class="vad-hint">32 steps = higher quality; 16 steps = ~2× faster</div>
				</div>
			{/if}
		{:else}
			<p class="skip-note">Enable to add voice to your companion</p>
		{/if}
	</div>

	<div class="ob-actions ob-actions--split">
		<button class="btn btn-secondary" onclick={onBack}>
			<Icon name="chevron-left" size={16} />
			Back
		</button>
		<button class="btn btn-primary" onclick={handleNext} disabled={!isLLMConfigured}>
			Next
			<Icon name="chevron-right" size={16} />
		</button>
	</div>
</div>

<style>
	/* Scrollable variant of the shared ob-step layout */
	.services-step {
		max-height: 70vh;
		overflow-y: auto;
	}

	.security-note {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.7rem 1rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.security-note :global(svg) {
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.service-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.1rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.service-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-secondary);
	}

	.service-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.required-badge {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-subtle);
		padding: 0.2rem 0.55rem;
		border-radius: var(--radius-full);
		margin-left: auto;
	}

	.optional-badge {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		background: var(--bg-tertiary);
		padding: 0.2rem 0.55rem;
		border-radius: var(--radius-full);
	}

	.toggle-btn {
		margin-left: auto;
		position: relative;
		width: 42px;
		height: 24px;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.toggle-track {
		display: block;
		width: 100%;
		height: 100%;
		background: var(--bg-tertiary);
		border-radius: var(--radius-full);
		transition: background 0.2s;
	}

	.toggle-btn.enabled .toggle-track {
		background: var(--accent);
	}

	.toggle-thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		background: var(--bg-primary);
		border-radius: 50%;
		transition: transform 0.2s;
		box-shadow: var(--shadow-xs);
	}

	.toggle-btn.enabled .toggle-thumb {
		background: #fff;
		transform: translateX(18px);
	}

	.api-key-input {
		width: 100%;
		padding: 0.85rem 1rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		font-size: 0.9rem;
		font-family: var(--font-mono);
		color: var(--text-primary);
		transition: all 0.2s;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.06),
			inset 0 1px 2px rgba(0, 0, 0, 0.04);
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
		background: linear-gradient(180deg, #1a1a1a 0%, #222222 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 2px rgba(0, 0, 0, 0.2);

	}

	:global(.dark) select.api-key-input option {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.api-key-input::placeholder {
		color: var(--text-tertiary);
	}

	.api-key-input:focus {
		outline: none;
		background: var(--bg-primary);
		box-shadow: 0 0 0 3px var(--accent-muted);
	}

	.api-key-input.error {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-error), transparent 78%);
		animation: shake 0.4s ease-out;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-4px); }
		40% { transform: translateX(4px); }
		60% { transform: translateX(-3px); }
		80% { transform: translateX(2px); }
	}

	.provider-note {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-success);
	}

	.provider-note.error {
		color: var(--color-error);
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

	.vad-sensitivity-row {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.vad-sensitivity-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.vad-value {
		color: var(--text-primary);
		font-weight: 600;
	}

	.vad-slider {
		width: 100%;
		accent-color: #01B2FF;
		cursor: pointer;
	}

	.vad-hint {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.skip-note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}
</style>

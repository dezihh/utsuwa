<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getTTSProvider } from '$lib/services/providers/registry';
	import { Icon, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import type { TtsSettingsState } from '$lib/stores/ai-services-settings.svelte';
	import './ai-services-settings.css';

	let { state }: { state: TtsSettingsState } = $props();

	const provider = $derived(getTTSProvider(state.speechSettings.activeProvider as string));
	const isChatterbox = $derived(provider?.id === 'chatterbox-ng');
	const enableAltLanguage = $derived(!!state.speechSettings.enableAltLanguage);
</script>

<div class="service-group">
	<div class="service-header">
		<Icon name="mic" size={14} />
		<span>Speech (TTS)</span>
		<button
			class="service-toggle"
			class:enabled={state.isTTSEnabled}
			onclick={state.toggleTTS}
			aria-label="Toggle speech (TTS)"
		>
			<span class="toggle-track">
				<span class="toggle-thumb"></span>
			</span>
		</button>
	</div>

	{#if state.isTTSEnabled}
		<ProviderDropdown
			type="tts"
			value={state.speechSettings.activeProvider as string}
			onSelect={state.handleTTSProviderChange}
			placeholder="Select TTS provider..."
		/>

		{#if provider}
			{#if provider.requiresApiKey}
				<div class="api-key-row">
					<input
						type="password"
						class="api-key-input"
						class:error={state.ttsFetchError}
						placeholder="API Key"
						value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
						oninput={(e) => state.handleApiKeyChange(provider.id, e.currentTarget.value)}
						onblur={state.handleTTSApiKeyBlur}
					/>
				</div>
			{/if}

			{#if isChatterbox}
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder={provider.defaultBaseUrl || 'http://localhost:8765/'}
						value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
						onchange={(e) => state.handleTTSBaseUrlChange(provider.id, e.currentTarget.value)}
					/>
				</div>

				<div class="api-key-row voice-row">
					<ModelDropdown
						models={state.ttsVoices}
						value={(state.speechSettings.activeVoiceId as string) || ''}
						onSelect={state.handleTTSVoiceChange}
						placeholder="Select voice..."
						isLoading={state.ttsIsLoading}
						onRefresh={state.fetchTTSVoices}
						disabled={!state.ttsBaseUrl}
						disabledMessage="Enter base URL first"
					/>
				</div>

				<div class="api-key-row">
					<input
						type="number"
						class="api-key-input"
						placeholder="Exaggeration (optional, 0.0-2.0)"
						value={settingsStore.getProviderConfig(provider.id).exaggeration ?? ''}
						step="0.1"
						onchange={(e) =>
							state.handleTTSNumberParam(
								provider.id,
								'exaggeration',
								e.currentTarget.value === '' ? undefined : parseFloat(e.currentTarget.value)
							)}
					/>
				</div>
				<div class="api-key-row">
					<input
						type="number"
						class="api-key-input"
						placeholder="CFG weight (optional, 0.0-2.0)"
						value={settingsStore.getProviderConfig(provider.id).cfgWeight ?? ''}
						step="0.1"
						onchange={(e) =>
							state.handleTTSNumberParam(
								provider.id,
								'cfgWeight',
								e.currentTarget.value === '' ? undefined : parseFloat(e.currentTarget.value)
							)}
					/>
				</div>
				<div class="api-key-row">
					<input
						type="number"
						class="api-key-input"
						placeholder="Temperature (optional, 0.0-1.0)"
						value={settingsStore.getProviderConfig(provider.id).temperature ?? ''}
						step="0.1"
						onchange={(e) =>
							state.handleTTSNumberParam(
								provider.id,
								'temperature',
								e.currentTarget.value === '' ? undefined : parseFloat(e.currentTarget.value)
							)}
					/>
				</div>
			{:else if provider.isLocal}
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						list="local-tts-voices"
						placeholder="Voice (e.g. af_bella)"
						value={state.speechSettings.activeVoiceId as string ?? ''}
						onchange={(e) => state.handleTTSVoiceChange(e.currentTarget.value)}
					/>
					<datalist id="local-tts-voices">
						{#each provider.voices ?? [] as voice}
							<option value={voice.id}>{voice.name}</option>
						{/each}
					</datalist>
				</div>
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder="Model (optional, e.g. kokoro)"
						value={state.speechSettings.activeModel as string ?? ''}
						onchange={(e) => state.handleTTSModelChange(e.currentTarget.value)}
					/>
				</div>
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder={provider.defaultBaseUrl || 'http://localhost:8880/v1/'}
						value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
						onchange={(e) => state.handleTTSBaseUrlChange(provider.id, e.currentTarget.value)}
					/>
				</div>
			{:else if provider.id === 'elevenlabs'}
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder="Custom Voice ID (optional)"
						value={settingsStore.elevenLabsVoiceId}
						onchange={(e) => settingsStore.setElevenLabsVoiceId(e.currentTarget.value)}
					/>
				</div>
			{/if}

			{#if !provider.isLocal && provider.id !== 'chatterbox-ng'}
				<ModelDropdown
					models={state.ttsModels}
					value={state.speechSettings.activeModel as string}
					onSelect={state.handleTTSModelChange}
					placeholder="Select model..."
					isLoading={state.ttsIsLoading}
					onRefresh={state.ttsHasApiKey ? state.fetchTTSModels : undefined}
					disabled={!state.ttsHasApiKey}
					disabledMessage="Enter API key first"
				/>
			{/if}

			{#if isChatterbox}
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder="Primary language (e.g. en, de, es)"
						value={(state.speechSettings.language as string) || 'en'}
						onchange={(e) => state.handleTTSLanguageChange(e.currentTarget.value)}
					/>
				</div>

				<div class="setting-row">
					<label class="setting-label">
						<input
							type="checkbox"
							checked={enableAltLanguage}
							onchange={(e) => state.handleTTSEnableAltLanguageChange(e.currentTarget.checked)}
						/>
						<span>Enable alternative language</span>
					</label>
				</div>

				{#if enableAltLanguage}
					<div class="api-key-row">
						<input
							type="text"
							class="api-key-input"
							placeholder="Alternative language (e.g. es, fr, it)"
							value={(state.speechSettings.altLanguage as string) || ''}
							onchange={(e) => state.handleTTSAltLanguageChange(e.currentTarget.value)}
						/>
					</div>
					<div class="api-key-row">
						<input
							type="text"
							class="api-key-input"
							placeholder="Alternative voice ID"
							value={(state.speechSettings.altVoiceId as string) || ''}
							onchange={(e) => state.handleTTSAltVoiceChange(e.currentTarget.value)}
						/>
					</div>
				{/if}
			{/if}
		{/if}
	{/if}
</div>

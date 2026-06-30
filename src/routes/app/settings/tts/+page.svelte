<script lang="ts">
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getTTSProvider } from '$lib/services/providers/registry';
	import { Icon, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import {
		fetchModels,
		getCachedModelsForProvider,
		debounce,
		type ModelInfo
	} from '$lib/services/providers/use-model-fetch';
	import { fetchAllTalkData, type AllTalkOption } from '$lib/services/providers/alltalk';
	import { fetchChatterboxVoices, type ChatterboxVoice } from '$lib/services/providers/chatterbox';

	const speechSettings = $derived(modulesStore.getModuleSettings('speech'));
	const isTTSEnabled = $derived.by(() => modulesStore.isModuleEnabled('speech'));

	const staticTTSModels = $derived.by(() => {
		const providerId = speechSettings.activeProvider as string;
		if (!providerId) return [];
		const provider = getTTSProvider(providerId);
		return provider?.models ?? [];
	});

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

	let omnivoiceClones = $state<{ id: string; name: string }[]>([]);
	let omnivoiceClonesLoading = $state(false);
	let omnivoiceClonesFetchError = $state<string | null>(null);
	let lastOmnivoiceFetchSignature = '';

	const ttsModels = $derived(ttsDynamicModels ?? staticTTSModels);

	const ttsHasApiKey = $derived.by(() => {
		const providerId = speechSettings.activeProvider as string;
		if (!providerId) return false;
		const provider = getTTSProvider(providerId);
		if (!provider) return false;
		if (provider.isLocal || !provider.requiresApiKey) return true;
		const config = settingsStore.getProviderConfig(providerId);
		return !!config.apiKey;
	});

	function withSelectedOption(options: AllTalkOption[], selected: string, fallbackLabel: string): AllTalkOption[] {
		if (!selected) return options;
		if (options.some((option) => option.id === selected)) return options;
		return [{ id: selected, name: fallbackLabel }, ...options];
	}

	const alltalkVoiceOptions = $derived.by(() =>
		withSelectedOption(alltalkVoices, speechSettings.activeVoiceId as string, 'Current voice')
	);

	const alltalkRvcVoiceOptions = $derived.by(() =>
		withSelectedOption(alltalkRvcVoices, speechSettings.activeRvcVoiceId as string, 'Current RVC voice')
	);

	async function fetchTTSModels() {
		const targetProvider = speechSettings.activeProvider as string;
		if (!targetProvider) return;
		const provider = getTTSProvider(targetProvider);
		if (!provider) return;

		const config = settingsStore.getProviderConfig(provider.id);

		await fetchModels({
			providerId: provider.id,
			apiKey: config.apiKey ?? '',
			baseUrl: config.baseUrl,
			isLocal: provider.isLocal,
			getCurrentProviderId: () => speechSettings.activeProvider as string,
			onStart: () => {
				ttsIsLoading = true;
				ttsFetchError = null;
			},
			onSuccess: (models) => {
				ttsIsLoading = false;
				ttsDynamicModels = models;
				const currentModel = speechSettings.activeModel as string;
				const modelExists = models.some(m => m.id === currentModel);
				if (!currentModel || !modelExists) {
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
		const targetProvider = speechSettings.activeProvider as string;
		if (targetProvider !== 'alltalk') return;

		const config = settingsStore.getProviderConfig('alltalk');

		alltalkIsLoading = true;
		alltalkFetchError = null;

		const result = await fetchAllTalkData(config.baseUrl, config.apiKey);
		if (speechSettings.activeProvider !== 'alltalk') {
			alltalkIsLoading = false;
			return;
		}

		alltalkIsLoading = false;
		alltalkReady = result.ready;
		alltalkVoices = result.voices;
		alltalkRvcVoices = result.rvcVoices;
		alltalkFetchError = result.error ?? null;

		if (!result.error) {
			const currentVoice = speechSettings.activeVoiceId as string;
			const currentRvcVoice = speechSettings.activeRvcVoiceId as string;
			const nextVoice =
				currentVoice && result.voices.some((voice) => voice.id === currentVoice)
					? currentVoice
					: result.defaultVoiceId || result.voices[0]?.id || '';
			const nextRvcVoice =
				currentRvcVoice && result.rvcVoices.some((voice) => voice.id === currentRvcVoice)
					? currentRvcVoice
					: result.defaultRvcVoiceId || result.rvcVoices[0]?.id || '';

			if (nextVoice && nextVoice !== currentVoice) {
				modulesStore.setModuleSetting('speech', 'activeVoiceId', nextVoice);
			}
			if (nextRvcVoice && nextRvcVoice !== currentRvcVoice) {
				modulesStore.setModuleSetting('speech', 'activeRvcVoiceId', nextRvcVoice);
			}
		}
	}

	const debouncedFetchTTSModels = debounce(fetchTTSModels, 300);
	const debouncedFetchAllTalkSettings = debounce(fetchAllTalkSettings, 300);

	async function loadChatterboxVoices() {
		const provider = getTTSProvider(speechSettings.activeProvider as string);
		if (provider?.id !== 'chatterbox') return;
		const config = settingsStore.getProviderConfig('chatterbox');
		chatterboxIsLoading = true;
		chatterboxFetchError = null;
		const result = await fetchChatterboxVoices(config.baseUrl);
		if (getTTSProvider(speechSettings.activeProvider as string)?.id !== 'chatterbox') {
			chatterboxIsLoading = false;
			return;
		}
		chatterboxIsLoading = false;
		chatterboxVoices = result.voices;
		chatterboxFetchError = result.error ?? null;
		if (!result.error && result.voices.length > 0) {
			const currentVoice = speechSettings.activeVoiceId as string;
			const hasCurrentVoice = currentVoice && result.voices.some((voice) => voice.id === currentVoice);
			if (!hasCurrentVoice) {
				const nextVoice = result.defaultVoiceId || result.voices[0]?.id || '';
				if (nextVoice) {
					modulesStore.setModuleSetting('speech', 'activeVoiceId', nextVoice);
				}
			}
		}
	}

	const debouncedLoadChatterboxVoices = debounce(loadChatterboxVoices, 300);

	async function loadOmniVoiceClones() {
		const provider = speechSettings.activeProvider as string;
		if (provider !== 'omnivoice') return;
		const config = settingsStore.getProviderConfig('omnivoice');
		const baseUrl = config.baseUrl || 'http://localhost:8766';
		omnivoiceClonesLoading = true;
		omnivoiceClonesFetchError = null;
		try {
			const res = await fetch(`/api/tts/omnivoice/voices?baseUrl=${encodeURIComponent(baseUrl)}`);
			if ((speechSettings.activeProvider as string) !== 'omnivoice') { omnivoiceClonesLoading = false; return; }
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			const list: unknown[] = Array.isArray(data) ? data : (Array.isArray(data?.voices) ? data.voices : []);
			omnivoiceClones = list.map((v: unknown) => {
				if (typeof v === 'string') return { id: v, name: v };
				const obj = v as Record<string, string>;
				return { id: obj.id ?? String(v), name: obj.name || obj.id || String(v) };
			});
		} catch (err) {
			omnivoiceClonesFetchError = err instanceof Error ? err.message : String(err);
		} finally {
			omnivoiceClonesLoading = false;
		}
	}

	const debouncedLoadOmniVoiceClones = debounce(loadOmniVoiceClones, 300);

	$effect(() => {
		const targetProvider = speechSettings.activeProvider as string;
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
		const targetProvider = speechSettings.activeProvider as string;
		if (targetProvider !== 'omnivoice') {
			lastOmnivoiceFetchSignature = '';
			omnivoiceClones = [];
			return;
		}
		const config = settingsStore.getProviderConfig('omnivoice');
		const sig = `omnivoice::${config.baseUrl ?? ''}`;
		if (sig === lastOmnivoiceFetchSignature) return;
		lastOmnivoiceFetchSignature = sig;
		debouncedLoadOmniVoiceClones();
	});

	$effect(() => {
		const targetProvider = speechSettings.activeProvider as string;
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

	function handleTTSProviderChange(providerId: string) {
		modulesStore.setModuleSetting('speech', 'activeProvider', providerId);
		const provider = getTTSProvider(providerId);

		ttsDynamicModels = null;
		ttsFetchError = null;
		ttsIsLoading = false;

		const cached = getCachedModelsForProvider(providerId);
		if (cached) {
			ttsDynamicModels = cached;
		}

		if (provider?.models?.length) {
			modulesStore.setModuleSetting('speech', 'activeModel', provider.models[0].id);
		}
		if (providerId === 'alltalk') {
			debouncedFetchAllTalkSettings();
		}
		if (provider?.isLocal || !provider?.requiresApiKey) {
			settingsStore.markProviderAdded(providerId);
		}
	}

	function handleTTSModelChange(modelId: string) {
		modulesStore.setModuleSetting('speech', 'activeModel', modelId);
	}

	function handleTTSApiKeyBlur() {
		const providerId = speechSettings.activeProvider as string;
		if (!providerId) return;
		const provider = getTTSProvider(providerId);
		const config = settingsStore.getProviderConfig(providerId);
		if (config.apiKey && provider && !provider.isLocal) {
			debouncedFetchTTSModels();
		}
	}

	function handleApiKeyChange(providerId: string, apiKey: string) {
		ttsFetchError = null;
		settingsStore.setProviderConfig(providerId, { apiKey });
		if (providerId === 'alltalk') {
			debouncedFetchAllTalkSettings();
		}
		if (apiKey) {
			settingsStore.markProviderAdded(providerId);
		}
	}

	function handleAllTalkVoiceChange(voiceId: string) {
		modulesStore.setModuleSetting('speech', 'activeVoiceId', voiceId);
	}

	function handleAllTalkRvcVoiceChange(voiceId: string) {
		modulesStore.setModuleSetting('speech', 'activeRvcVoiceId', voiceId);
	}

	function handleTTSBaseUrlChange(baseUrl: string) {
		const providerId = speechSettings.activeProvider as string;
		if (!providerId) return;
		const provider = getTTSProvider(providerId);
		if (!provider) return;

		ttsFetchError = null;
		alltalkFetchError = null;
		settingsStore.setProviderConfig(providerId, { baseUrl });
		if (providerId === 'alltalk') {
			debouncedFetchAllTalkSettings();
		}
		if (providerId === 'chatterbox') {
			debouncedLoadChatterboxVoices();
		}
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

	function toggleTTS() {
		modulesStore.setModuleEnabled('speech', !isTTSEnabled);
	}
</script>

<div class="page">
	<header class="page-header">
		<h2>Text-to-Speech</h2>
		<p>Configure speech synthesis providers and voices.</p>
	</header>

	<div class="sections">
		<section class="section">
							<!-- TTS Config -->
							<div class="service-group">
								<div class="service-header">
									<Icon name="mic" size={14} />
									<span>Speech (TTS)</span>
									<button class="service-toggle" class:enabled={isTTSEnabled} onclick={toggleTTS} aria-label="Toggle TTS">
										<span class="toggle-track">
											<span class="toggle-thumb"></span>
										</span>
									</button>
								</div>

								{#if isTTSEnabled}
									<ProviderDropdown
										type="tts"
										value={speechSettings.activeProvider as string}
										onSelect={handleTTSProviderChange}
										placeholder="Select TTS provider..."
									/>

									{#if speechSettings.activeProvider}
										{@const provider = getTTSProvider(speechSettings.activeProvider as string)}
										{#if provider?.requiresApiKey}
											<div class="api-key-row">
												<input
													type="password"
													class="api-key-input"
													class:error={ttsFetchError}
													placeholder="API Key"
													value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
													oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value)}
													onblur={handleTTSApiKeyBlur}
												/>
											</div>
										{/if}
										{#if provider?.id === 'alltalk'}
											<div class="api-key-row">
												<input
													type="password"
													class="api-key-input"
													placeholder="Auth token (optional)"
													value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
													oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value)}
													onblur={handleTTSApiKeyBlur}
												/>
											</div>
										{/if}
									{/if}

									{#if speechSettings.activeProvider}
										{@const provider = getTTSProvider(speechSettings.activeProvider as string)}
										{#if provider?.id !== 'alltalk' && !provider?.isLocal}
											<ModelDropdown
												models={ttsModels}
												value={speechSettings.activeModel as string}
												onSelect={handleTTSModelChange}
												placeholder="Select model..."
												isLoading={ttsIsLoading}
												onRefresh={ttsHasApiKey ? fetchTTSModels : undefined}
												disabled={!ttsHasApiKey}
												disabledMessage="Enter API key first"
											/>
										{/if}
									{/if}

									{#if speechSettings.activeProvider === 'elevenlabs'}
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

									{#if speechSettings.activeProvider}
										{@const provider = getTTSProvider(speechSettings.activeProvider as string)}
										{#if provider?.isLocal && provider.id !== 'alltalk' && provider.id !== 'chatterbox' && provider.id !== 'omnivoice'}
											<div class="api-key-row">
												<input
													type="text"
													class="api-key-input"
													placeholder="Model/voice name"
													value={speechSettings.activeModel as string ?? ''}
													onchange={(e) => handleTTSModelChange(e.currentTarget.value)}
												/>
											</div>
										{/if}
										{#if provider?.isLocal && provider.id !== 'alltalk' && provider.id !== 'chatterbox' && provider.id !== 'omnivoice'}
											<div class="api-key-row">
												<input
													type="text"
													class="api-key-input"
													placeholder={provider.defaultBaseUrl || 'http://localhost:5000/'}
													value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
													onchange={(e) => settingsStore.setProviderConfig(provider.id, { baseUrl: e.currentTarget.value })}
												/>
											</div>
										{/if}
									{/if}

									{#if speechSettings.activeProvider === 'omnivoice'}
										<!-- URL -->
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												placeholder={getTTSProvider('omnivoice')?.defaultBaseUrl || 'http://localhost:8766/'}
												value={settingsStore.getProviderConfig('omnivoice').baseUrl ?? ''}
												oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
											/>
										</div>
										<p class="provider-note">
											<Icon name="check-circle" size={14} />
											Local provider - no API key needed
										</p>
										<!-- Diffusion quality -->
										<div class="vad-sensitivity-row">
											<label class="vad-sensitivity-label" for="ps-ov-numstep">
												Quality
												<span class="vad-value"
													>{settingsStore.getProviderConfig('omnivoice').omnivoiceNumStep === 16
														? 'Fast (16)'
														: 'Quality (32)'}</span
												>
											</label>
											<select
												id="ps-ov-numstep"
												class="api-key-input"
												value={String(settingsStore.getProviderConfig('omnivoice').omnivoiceNumStep ?? 32)}
												onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceNumStep: Number(e.currentTarget.value) })}
											>
												<option value="32">Quality — 32 steps</option>
												<option value="16">Fast — 16 steps</option>
											</select>
										</div>

										<div class="vad-sensitivity-row">
											<label class="vad-sensitivity-label" for="ps-ov-lang">Primary Language</label>
											<select
												id="ps-ov-lang"
												class="api-key-input"
												value={settingsStore.getProviderConfig('omnivoice').language ?? ''}
												onchange={(e) => settingsStore.setProviderConfig('omnivoice', { language: e.currentTarget.value || undefined })}
											>
												<option value="">Auto-detect</option>
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
												<option value="ar">Arabic (ar)</option>
												<option value="nl">Dutch (nl)</option>
												<option value="pl">Polish (pl)</option>
											</select>
										</div>
										<p class="provider-note">Required for automatic alt-voice switching on language change.</p>

										<!-- ── Default Voice Profile ── -->
										<div class="ov-profile-header">Default Voice</div>

										<div class="vad-sensitivity-row">
											<label class="vad-sensitivity-label" for="ps-ov-def-type">Voice Type</label>
											<select
												id="ps-ov-def-type"
												class="api-key-input"
												value={settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultVoiceType ?? 'internal'}
												onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceDefaultVoiceType: e.currentTarget.value as 'internal' | 'clone' })}
											>
												<option value="internal">Synthetic (voice design)</option>
												<option value="clone">Voice Clone (sample)</option>
											</select>
										</div>

										{#if (settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultVoiceType ?? 'internal') === 'internal'}
											<div class="vad-sensitivity-row">
												<label class="vad-sensitivity-label" for="ps-ov-def-gender">Gender</label>
												<select
													id="ps-ov-def-gender"
													class="api-key-input"
													value={settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultGender ?? 'female'}
													onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceDefaultGender: e.currentTarget.value })}
												>
													<option value="female">Female</option>
													<option value="male">Male</option>
												</select>
											</div>
											<div class="vad-sensitivity-row">
												<label class="vad-sensitivity-label" for="ps-ov-def-age">Age</label>
												<select
													id="ps-ov-def-age"
													class="api-key-input"
													value={settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultAge ?? 'young adult'}
													onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceDefaultAge: e.currentTarget.value })}
												>
													<option value="child">Child</option>
													<option value="teenager">Teenager</option>
													<option value="young adult">Young Adult</option>
													<option value="middle-aged">Middle-aged</option>
													<option value="elderly">Elderly</option>
												</select>
											</div>
											<div class="vad-sensitivity-row">
												<label class="vad-sensitivity-label" for="ps-ov-def-pitch">Pitch</label>
												<select
													id="ps-ov-def-pitch"
													class="api-key-input"
													value={settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultPitch ?? 'moderate pitch'}
													onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceDefaultPitch: e.currentTarget.value })}
												>
													<option value="very low pitch">Very Low</option>
													<option value="low pitch">Low</option>
													<option value="moderate pitch">Moderate</option>
													<option value="high pitch">High</option>
													<option value="very high pitch">Very High</option>
												</select>
											</div>
										{:else}
											<div class="vad-sensitivity-row">
												<label class="vad-sensitivity-label" for="ps-ov-def-clone">Voice Sample</label>
												<select
													id="ps-ov-def-clone"
													class="api-key-input"
													disabled={omnivoiceClonesLoading}
													value={settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultCloneId ?? ''}
													onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceDefaultCloneId: e.currentTarget.value })}
												>
													<option value="">{omnivoiceClonesLoading ? 'Loading...' : omnivoiceClones.length === 0 ? 'No clones found' : 'Select clone...'}</option>
													{#each omnivoiceClones as clone}
														<option value={clone.id}>{clone.name}</option>
													{/each}
												</select>
											</div>
											{#if omnivoiceClonesFetchError}
												<p class="provider-note error">{omnivoiceClonesFetchError}</p>
											{/if}
										{/if}


										<!-- ── Alternative Voice Profile ── -->
										<div class="ov-profile-header ov-alt-header">
											<label class="ov-alt-toggle">
												<input
													type="checkbox"
													checked={settingsStore.getProviderConfig('omnivoice').omnivoiceAltEnabled ?? false}
													onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltEnabled: e.currentTarget.checked })}
												/>
												Alternative Voice
											</label>
										</div>

										{#if settingsStore.getProviderConfig('omnivoice').omnivoiceAltEnabled}
											<div class="vad-sensitivity-row">
												<label class="vad-sensitivity-label" for="ps-ov-alt-type">Voice Type</label>
												<select
													id="ps-ov-alt-type"
													class="api-key-input"
													value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltVoiceType ?? 'internal'}
													onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltVoiceType: e.currentTarget.value as 'internal' | 'clone' })}
												>
													<option value="internal">Synthetic (voice design)</option>
													<option value="clone">Voice Clone (sample)</option>
												</select>
											</div>

											{#if (settingsStore.getProviderConfig('omnivoice').omnivoiceAltVoiceType ?? 'internal') === 'internal'}
												<div class="vad-sensitivity-row">
													<label class="vad-sensitivity-label" for="ps-ov-alt-gender">Gender</label>
													<select
														id="ps-ov-alt-gender"
														class="api-key-input"
														value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltGender ?? 'male'}
														onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltGender: e.currentTarget.value })}
													>
														<option value="female">Female</option>
														<option value="male">Male</option>
													</select>
												</div>
												<div class="vad-sensitivity-row">
													<label class="vad-sensitivity-label" for="ps-ov-alt-age">Age</label>
													<select
														id="ps-ov-alt-age"
														class="api-key-input"
														value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltAge ?? 'young adult'}
														onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltAge: e.currentTarget.value })}
													>
														<option value="child">Child</option>
														<option value="teenager">Teenager</option>
														<option value="young adult">Young Adult</option>
														<option value="middle-aged">Middle-aged</option>
														<option value="elderly">Elderly</option>
													</select>
												</div>
												<div class="vad-sensitivity-row">
													<label class="vad-sensitivity-label" for="ps-ov-alt-pitch">Pitch</label>
													<select
														id="ps-ov-alt-pitch"
														class="api-key-input"
														value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltPitch ?? 'moderate pitch'}
														onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltPitch: e.currentTarget.value })}
													>
														<option value="very low pitch">Very Low</option>
														<option value="low pitch">Low</option>
														<option value="moderate pitch">Moderate</option>
														<option value="high pitch">High</option>
														<option value="very high pitch">Very High</option>
													</select>
												</div>
											{:else}
												<div class="vad-sensitivity-row">
													<label class="vad-sensitivity-label" for="ps-ov-alt-clone">Voice Sample</label>
													<select
														id="ps-ov-alt-clone"
														class="api-key-input"
														disabled={omnivoiceClonesLoading}
														value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltCloneId ?? ''}
														onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltCloneId: e.currentTarget.value })}
													>
														<option value="">{omnivoiceClonesLoading ? 'Loading...' : omnivoiceClones.length === 0 ? 'No clones found' : 'Select clone...'}</option>
														{#each omnivoiceClones as clone}
															<option value={clone.id}>{clone.name}</option>
														{/each}
													</select>
												</div>
												{#if omnivoiceClonesFetchError}
													<p class="provider-note error">{omnivoiceClonesFetchError}</p>
	<p class="provider-note">Only text tagged with this language code triggers the alternative voice. Other languages use the default voice.</p>
										{/if}
									{/if}

									<div class="vad-sensitivity-row">
											<label class="vad-sensitivity-label" for="ps-ov-alt-lang">Alternative Language</label>
											<select
												id="ps-ov-alt-lang"
												class="api-key-input"
												value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltLanguage ?? ''}
												onchange={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltLanguage: e.currentTarget.value || undefined })}
											>
												<option value="">Any non-primary language</option>
												<option value="es">Spanish (es)</option>
												<option value="en">English (en)</option>
												<option value="fr">French (fr)</option>
												<option value="it">Italian (it)</option>
												<option value="pt">Portuguese (pt)</option>
												<option value="ja">Japanese (ja)</option>
												<option value="zh">Chinese (zh)</option>
												<option value="ko">Korean (ko)</option>
												<option value="ru">Russian (ru)</option>
												<option value="ar">Arabic (ar)</option>
												<option value="nl">Dutch (nl)</option>
												<option value="pl">Polish (pl)</option>
											</select>
										</div>
										<p class="provider-note">Only [lang:xx] tags matching this language switch to the alternative voice. Other languages keep the default voice.</p>
									{/if}
								{/if}

								{#if speechSettings.activeProvider === 'chatterbox'}
										<div class="api-key-row">
											<select
												class="api-key-input"
												value={speechSettings.activeVoiceId as string ?? ''}
												onchange={(e) => handleChatterboxVoiceChange(e.currentTarget.value)}
												disabled={chatterboxIsLoading}
											>
												<option value="">
													{chatterboxIsLoading ? 'Loading voices...' : 'Select a voice...'}
												</option>
												{#if chatterboxVoices.some(v => v.type !== 'clone')}
													<optgroup label="── Predefined ──">
														{#each chatterboxVoices.filter(v => v.type !== 'clone') as voice}
															<option value={voice.id}>{voice.name}</option>
														{/each}
													</optgroup>
												{/if}
												{#if chatterboxVoices.some(v => v.type === 'clone')}
													<optgroup label="── Voice Clones ──">
														{#each chatterboxVoices.filter(v => v.type === 'clone') as voice}
															<option value={voice.id}>🎙 {voice.name}</option>
														{/each}
													</optgroup>
												{/if}
											</select>
										</div>
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												class:error={!!chatterboxFetchError}
												placeholder={getTTSProvider('chatterbox')?.defaultBaseUrl || 'http://localhost:8765/'}
												value={settingsStore.getProviderConfig('chatterbox').baseUrl ?? ''}
												oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
											/>
										</div>
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
											<label class="vad-sensitivity-label" for="ps-cb-language">Language</label>
											<select
												id="ps-cb-language"
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
											<label class="vad-sensitivity-label" for="ps-cb-exaggeration">
												Exaggeration
												<span class="vad-value">{(settingsStore.getProviderConfig('chatterbox').exaggeration ?? 0.5).toFixed(2)}</span>
											</label>
											<input
												id="ps-cb-exaggeration"
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
											<label class="vad-sensitivity-label" for="ps-cb-cfg-weight">
												CFG Weight
												<span class="vad-value">{(settingsStore.getProviderConfig('chatterbox').cfgWeight ?? 0.5).toFixed(2)}</span>
											</label>
											<input
												id="ps-cb-cfg-weight"
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
											<label class="vad-sensitivity-label" for="ps-cb-temperature">
												Temperature
												<span class="vad-value">{(settingsStore.getProviderConfig('chatterbox').temperature ?? 0.8).toFixed(2)}</span>
											</label>
											<input
												id="ps-cb-temperature"
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

										<div class="chatterbox-tag-docs">
											<div class="tag-docs-title">LLM Tags für Sprache &amp; Emotion</div>
											<div class="tag-docs-body">
												<p>Das LLM kann diese Tags in Antworten einbetten – sie steuern Aussprache und Klang, sind im Chat aber nicht sichtbar.</p>
												<div class="tag-group">
													<span class="tag-group-label">Sprache</span>
													<code>[lang:es]</code> Spanisch &nbsp;
													<code>[lang:de]</code> Deutsch &nbsp;
													<code>[lang:en]</code> Englisch &nbsp;
													<code>[lang:fr]</code> Französisch
												</div>
												<div class="tag-group">
													<span class="tag-group-label">Emotion / Klang</span>
													<code>[laugh]</code> 😄 &nbsp;
													<code>[giggle]</code> 🙈 &nbsp;
													<code>[chuckle]</code> 😏 &nbsp;
													<code>[sigh]</code> 😮‍💨<br />
													<code>[excited]</code> &nbsp;
													<code>[sad]</code> &nbsp;
													<code>[calm]</code> &nbsp;
													<code>[whisper]</code> &nbsp;
													<code>[dramatic]</code>
												</div>
												<div class="tag-group">
													<span class="tag-group-label">Beispiel für System-Prompt</span>
													<em>„Markiere Spanisch mit [lang:es] und Deutsch mit [lang:de]. Nutze [laugh] oder [giggle] wenn du lachst."</em>
												</div>
											</div>
										</div>
									{/if}

									{#if speechSettings.activeProvider === 'alltalk'}
										<div class="api-key-row">
											<select
												class="api-key-input"
												value={speechSettings.activeVoiceId as string}
												onchange={(e) => handleAllTalkVoiceChange(e.currentTarget.value)}
												disabled={alltalkIsLoading}
											>
												<option value="">Select a voice...</option>
												{#each alltalkVoiceOptions as voice}
													<option value={voice.id}>{voice.name}</option>
												{/each}
											</select>
										</div>
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												class:error={!!alltalkFetchError}
												placeholder={getTTSProvider('alltalk')?.defaultBaseUrl || 'http://localhost:7851/api/'}
												value={settingsStore.getProviderConfig('alltalk').baseUrl ?? ''}
												oninput={(e) => handleTTSBaseUrlChange(e.currentTarget.value)}
											/>
										</div>
										{#if alltalkRvcVoiceOptions.length > 0}
											<div class="api-key-row">
												<select
													class="api-key-input"
													value={speechSettings.activeRvcVoiceId as string}
													onchange={(e) => handleAllTalkRvcVoiceChange(e.currentTarget.value)}
													disabled={alltalkIsLoading}
												>
													<option value="">Select an RVC voice...</option>
													{#each alltalkRvcVoiceOptions as voice}
														<option value={voice.id}>{voice.name}</option>
													{/each}
												</select>
											</div>
										{/if}
										{#if alltalkFetchError}
											<p class="provider-note error">{alltalkFetchError}</p>
										{:else}
											<p class="provider-note">
												<Icon name={alltalkReady ? 'check-circle' : 'alert-circle'} size={14} />
												{alltalkReady ? 'AllTalk is ready' : 'AllTalk status unknown'}
											</p>
										{/if}
									{/if}
								{/if}
							</div>

							<section class="service-group">
								<div class="service-header">
									<Icon name="help-circle" size={14} />
									<span>Troubleshooting</span>
								</div>
								<p class="provider-note">
									If language switching, voice tags or pronunciation sound wrong, the issue is often the LLM not following the tag instructions precisely. Try a <strong>stronger model</strong> and/or <strong>lower the temperature</strong> in the LLM provider settings.
								</p>
							</section>
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

	.ov-profile-header {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		margin: 0.75rem 0 0.25rem 0;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
	}

	.ov-alt-header {
		margin-top: 1rem;
	}

	.ov-alt-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
	}

	.ov-alt-toggle input[type='checkbox'] {
		accent-color: #10b981;
		cursor: pointer;
	}

	.chatterbox-tag-docs {
		margin-top: 1rem;
		border: 1px solid var(--border-color, rgba(255,255,255,0.1));
		border-radius: 8px;
		padding: 0.75rem;
		background: var(--bg-secondary, rgba(0,0,0,0.2));
	}

	.tag-docs-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.tag-docs-body {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		line-height: 1.6;
	}

	.tag-docs-body p {
		margin: 0 0 0.5rem 0;
	}

	.tag-group {
		margin-bottom: 0.4rem;
	}

	.tag-group-label {
		font-weight: 600;
		color: var(--text-secondary);
		display: block;
		margin-bottom: 0.15rem;
	}

	.tag-docs-body code {
		background: var(--bg-tertiary, rgba(255,255,255,0.08));
		border-radius: 3px;
		padding: 0.05em 0.3em;
		font-size: 0.68rem;
		color: var(--accent-color, #a78bfa);
	}

	.tag-docs-body em {
		color: var(--text-secondary);
		font-style: italic;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-4px); }
		40% { transform: translateX(4px); }
		60% { transform: translateX(-3px); }
		80% { transform: translateX(2px); }
	}
</style>
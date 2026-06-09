<script lang="ts">
	import { personaStore } from '$lib/stores/persona.svelte';
	import { characterStore } from '$lib/stores/character.svelte';
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { settingsStore, type PersonalityPreset } from '$lib/stores/settings.svelte';
	import { getLLMProvider, getTTSProvider } from '$lib/services/providers/registry';

	import { Icon, Progress, Tooltip, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import VrmUploader from '$lib/components/vrm/VrmUploader.svelte';
	import { allEvents } from '$lib/data/events';
	import { getCompletedEvents } from '$lib/services/storage/events';
	import type { CompletedEventRecord, EventType } from '$lib/types/events';
	import {
		fetchModels,
		getCachedModelsForProvider,
		debounce,
		type ModelInfo
	} from '$lib/services/providers/use-model-fetch';
	import { fetchAllTalkData, type AllTalkOption } from '$lib/services/providers/alltalk';
	import { fetchChatterboxVoices, type ChatterboxVoice } from '$lib/services/providers/chatterbox';
	import { getKnownEmotionTags } from '$lib/utils/sentences';
	import type { EmotionMapping } from '$lib/services/vrm/expression-controller';

	// Character state - single companion system
	const charState = $derived.by(() => characterStore.state);
	const moodInfo = $derived.by(() => characterStore.moodInfo);
	const stageInfo = $derived.by(() => characterStore.stageInfo);
	const affectionPercent = $derived.by(() => characterStore.affectionPercent);
	const isCharacterLoading = $derived.by(() => characterStore.isLoading);
	const appMode = $derived.by(() => characterStore.appMode);
	const isDatingSimMode = $derived.by(() => characterStore.appMode === 'dating_sim');

	// Completed events with full records (includes dates)
	let completedEventRecords = $state<CompletedEventRecord[]>([]);

	// Load completed events from database
	$effect(() => {
		if (isDatingSimMode) {
			getCompletedEvents().then(records => {
				completedEventRecords = records;
			});
		}
	});

	// Achievement data with event definitions joined
	interface Achievement {
		id: string;
		name: string;
		type: EventType;
		completedAt: Date;
	}

	const achievements = $derived.by(() => {
		return completedEventRecords
			.map(record => {
				const eventDef = allEvents.find(e => e.id === record.eventId);
				if (!eventDef) return null;
				return {
					id: record.eventId,
					name: eventDef.name,
					type: eventDef.type,
					completedAt: record.completedAt
				} as Achievement;
			})
			.filter((a): a is Achievement => a !== null)
			.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
	});

	// Color and icon config for achievement types
	const achievementConfig: Record<EventType, { color: string; bgColor: string; icon: string; label: string }> = {
		milestone: { color: 'var(--ctp-yellow)', bgColor: 'var(--ctp-yellow)', icon: 'trophy', label: 'Milestone' },
		anniversary: { color: 'var(--ctp-pink)', bgColor: 'var(--ctp-pink)', icon: 'heart', label: 'Anniversary' },
		conditional: { color: 'var(--ctp-mauve)', bgColor: 'var(--ctp-mauve)', icon: 'award', label: 'Unlocked' },
		random: { color: 'var(--ctp-teal)', bgColor: 'var(--ctp-teal)', icon: 'sparkles', label: 'Surprise' },
		scheduled: { color: 'var(--ctp-blue)', bgColor: 'var(--ctp-blue)', icon: 'calendar', label: 'Event' }
	};

	function formatAchievementDate(date: Date): string {
		return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	// Persona form state
	let formName = $state('');
	let formSystemPrompt = $state('');
	let personalityExpanded = $state(false);

	// Personality profiles
	let editingProfileId = $state<string | null>(null);
	let editingProfileName = $state('');

	const activeProfileId = $derived(settingsStore.getActiveProfileId());
	const personalityProfiles = $derived(settingsStore.getPersonalityProfiles());
	const activeProfile = $derived(personalityProfiles.find((p) => p.id === activeProfileId) ?? personalityProfiles[0]);
	let aiServicesExpanded = $state(false);
	let expressionMappingExpanded = $state(false);
	let eventsExpanded = $state(false);
	let uploadModalOpen = $state(false);
	let modeConfirmOpen = $state(false);
	let pendingMode = $state<'companion' | 'dating_sim' | null>(null);
	const emotionTags = getKnownEmotionTags();

	// AI Services state
	const consciousnessSettings = $derived(modulesStore.getModuleSettings('consciousness'));
	const speechSettings = $derived(modulesStore.getModuleSettings('speech'));
	const isLLMEnabled = $derived.by(() => modulesStore.isModuleEnabled('consciousness'));
	const isTTSEnabled = $derived.by(() => modulesStore.isModuleEnabled('speech'));

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
	const llmSupportsBrowsing = $derived.by(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		return ['ollama', 'llamacpp'].includes(providerId);
	});

	// Use dynamic models if available, otherwise static
	const llmModels = $derived(
		llmSupportsBrowsing ? llmDynamicModels ?? [] : llmDynamicModels ?? staticLLMModels
	);

	// Check if API key (and baseUrl for openai-compatible) is present for current LLM provider
	const llmHasApiKey = $derived.by(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return false;
		const provider = getLLMProvider(providerId);
		if (!provider) return false;
		if (provider.isLocal || !provider.requiresApiKey) return true;
		const config = settingsStore.getProviderConfig(providerId);
		if (providerId === 'openai-compatible') {
			return !!config.apiKey && !!config.baseUrl;
		}
		return !!config.apiKey;
	});

	const staticTTSModels = $derived.by(() => {
		const providerId = speechSettings.activeProvider as string;
		if (!providerId) return [];
		const provider = getTTSProvider(providerId);
		return provider?.models ?? [];
	});

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

	let omnivoiceClones = $state<{ id: string; name: string }[]>([]);
	let omnivoiceClonesLoading = $state(false);
	let omnivoiceClonesFetchError = $state<string | null>(null);
	let lastOmnivoiceFetchSignature = '';

	// Use dynamic models if available, otherwise static
	const ttsModels = $derived(ttsDynamicModels ?? staticTTSModels);

	// Check if API key is present for current TTS provider
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

	// Fetch LLM models from provider API
	async function fetchLLMModels(targetProvider = consciousnessSettings.activeProvider as string) {
		if (!targetProvider) return;
		const provider = getLLMProvider(targetProvider);
		if (!provider) return;
		const supportsBrowsing = ['ollama', 'llamacpp'].includes(provider.id);

		const config = settingsStore.getProviderConfig(provider.id);

		await fetchModels({
			providerId: provider.id,
			apiKey: config.apiKey ?? '',
			baseUrl: config.baseUrl,
			isLocal: provider.isLocal,
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
				llmDynamicModels = provider.isLocal ? [] : null;
			},
			onEmpty: () => {
				llmIsLoading = false;
				llmFetchError = supportsBrowsing ? 'No models found' : 'Using default list';
				llmDynamicModels = supportsBrowsing ? [] : null;
			},
			onStale: () => {
				llmIsLoading = false;
			}
		});
	}

	// Fetch TTS models from provider API
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
				// Auto-select first model if none selected or current selection not in list
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

	// Debounced fetch to avoid rapid API calls
	const debouncedFetchLLMModels = debounce(fetchLLMModels, 300);
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
			// Response: {"voices": [{id, name, ...}]} or [{id, name}] or ["id", ...]
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

	$effect(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		const provider = providerId ? getLLMProvider(providerId) : null;
		if (!provider?.isLocal) {
			lastLocalLLMFetchKey = '';
			return;
		}

		const baseUrl = settingsStore.getProviderConfig(provider.id).baseUrl ?? provider.defaultBaseUrl ?? '';
		const fetchKey = `${provider.id}:${baseUrl}`;

		if (fetchKey !== lastLocalLLMFetchKey) {
			lastLocalLLMFetchKey = fetchKey;
			debouncedFetchLLMModels();
		}
	});

	// For non-local providers (e.g. openai-compatible), load models on mount
	// if they haven't been fetched yet. Uses cache first, then fetches.
	$effect(() => {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;

		const provider = getLLMProvider(providerId);
		if (!provider || provider.isLocal) return; // Local handled above

		// Already loaded — nothing to do
		if (llmDynamicModels !== null) return;

		// Try cached models first
		const cached = getCachedModelsForProvider(providerId);
		if (cached) {
			llmDynamicModels = cached;
			return;
		}

		// Fetch if configured
		const config = settingsStore.getProviderConfig(providerId);
		const hasKey = !!config.apiKey;
		const hasUrl = providerId !== 'openai-compatible' || !!config.baseUrl;
		if (provider.requiresApiKey && hasKey && hasUrl) {
			debouncedFetchLLMModels(providerId);
		}
	});

	// Load form values from store when character is ready
	$effect(() => {
		if (characterStore.isReady) {
			formName = personaStore.name;
			// If the active "Standard" profile is still empty, seed it from the character store
			const currentProfile = settingsStore.getPersonalityProfiles().find(
				(p) => p.id === settingsStore.getActiveProfileId()
			);
			if (currentProfile) {
				if (currentProfile.id === 'standard' && !currentProfile.systemPrompt && personaStore.systemPrompt) {
					settingsStore.updatePersonalityProfile('standard', { systemPrompt: personaStore.systemPrompt });
				}
				formSystemPrompt = currentProfile.id === 'standard' && !currentProfile.systemPrompt
					? personaStore.systemPrompt
					: currentProfile.systemPrompt;
			} else {
				formSystemPrompt = personaStore.systemPrompt;
			}
		}
	});

	function saveName() {
		personaStore.updateCard({ name: formName.trim() || 'Utsuwa' });
	}

	function saveSystemPrompt() {
		const id = settingsStore.getActiveProfileId();
		settingsStore.updatePersonalityProfile(id, { systemPrompt: formSystemPrompt });
		personaStore.updateCard({ systemPrompt: formSystemPrompt });
	}

	function switchProfile(profileId: string) {
		// Persist current textarea to current profile before switching
		const currentId = settingsStore.getActiveProfileId();
		settingsStore.updatePersonalityProfile(currentId, { systemPrompt: formSystemPrompt });
		// Switch
		settingsStore.setActiveProfileId(profileId);
		const next = settingsStore.getPersonalityProfiles().find((p) => p.id === profileId);
		if (next) {
			formSystemPrompt = next.systemPrompt;
			personaStore.updateCard({ systemPrompt: next.systemPrompt });
		}
	}

	function addProfile() {
		const id = crypto.randomUUID();
		const newProfile: PersonalityPreset = { id, name: 'Neues Profil', systemPrompt: '' };
		settingsStore.addPersonalityProfile(newProfile);
		// Switch to it and open rename mode
		settingsStore.updatePersonalityProfile(settingsStore.getActiveProfileId(), { systemPrompt: formSystemPrompt });
		settingsStore.setActiveProfileId(id);
		formSystemPrompt = '';
		personaStore.updateCard({ systemPrompt: '' });
		editingProfileId = id;
		editingProfileName = newProfile.name;
	}

	function deleteProfile(id: string) {
		const profiles = settingsStore.getPersonalityProfiles();
		if (profiles.length <= 1) return;
		const isActive = settingsStore.getActiveProfileId() === id;
		settingsStore.removePersonalityProfile(id);
		if (isActive) {
			const remaining = settingsStore.getPersonalityProfiles();
			const next = remaining[0];
			if (next) {
				settingsStore.setActiveProfileId(next.id);
				formSystemPrompt = next.systemPrompt;
				personaStore.updateCard({ systemPrompt: next.systemPrompt });
			}
		}
	}

	function startRename(profile: PersonalityPreset) {
		editingProfileId = profile.id;
		editingProfileName = profile.name;
	}

	function commitRename() {
		if (editingProfileId && editingProfileName.trim()) {
			settingsStore.updatePersonalityProfile(editingProfileId, { name: editingProfileName.trim() });
		}
		editingProfileId = null;
		editingProfileName = '';
	}

	// AI Services handlers
	function handleLLMProviderChange(providerId: string) {
		modulesStore.setModuleSetting('consciousness', 'activeProvider', providerId);
		const provider = getLLMProvider(providerId);

		// Set default base URL if not already configured
		if (provider?.defaultBaseUrl && !settingsStore.getProviderConfig(providerId).baseUrl) {
			settingsStore.setProviderConfig(providerId, { baseUrl: provider.defaultBaseUrl });
		}

		// Reset dynamic models when provider changes
		llmDynamicModels = null;
		llmFetchError = null;
		llmIsLoading = false;

		// Check for cached models
		const cached = getCachedModelsForProvider(providerId);
		if (cached) {
			llmDynamicModels = cached;
		}

		if (provider && !provider.isLocal && provider.models?.length) {
			modulesStore.setModuleSetting('consciousness', 'activeModel', provider.models[0].id);
		}
		const config = settingsStore.getProviderConfig(providerId);
		const hasKey = !!config.apiKey;
		const hasUrl = providerId !== 'openai-compatible' || !!config.baseUrl;
		if (provider && (provider.isLocal || (provider.requiresApiKey && hasKey && hasUrl))) {
			debouncedFetchLLMModels(providerId);
		}
		// Mark local providers as added immediately (they don't need API keys)
		if (provider?.isLocal || !provider?.requiresApiKey) {
			settingsStore.markProviderAdded(providerId);
		}
	}

	function handleLLMModelChange(modelId: string) {
		modulesStore.setModuleSetting('consciousness', 'activeModel', modelId);
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
			debouncedFetchAllTalkSettings();
		}
		// Mark local providers as added immediately (they don't need API keys)
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

	function handleApiKeyChange(providerId: string, apiKey: string, type: 'llm' | 'tts') {
		// Clear error when user types
		if (type === 'llm') llmFetchError = null;
		if (type === 'tts') ttsFetchError = null;

		settingsStore.setProviderConfig(providerId, { apiKey });
		if (type === 'tts' && providerId === 'alltalk') {
			debouncedFetchAllTalkSettings();
		}
		if (apiKey) {
			settingsStore.markProviderAdded(providerId);
		}
	}

	function handleLLMApiKeyBlur() {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;
		const provider = getLLMProvider(providerId);
		const config = settingsStore.getProviderConfig(providerId);
		const hasUrl = providerId !== 'openai-compatible' || !!config.baseUrl;
		if (config.apiKey && provider && !provider.isLocal && hasUrl) {
			debouncedFetchLLMModels();
		}
	}

	function handleLLMBaseUrlChange(baseUrl: string) {
		const providerId = consciousnessSettings.activeProvider as string;
		if (!providerId) return;
		const provider = getLLMProvider(providerId);
		if (!provider) return;

		llmFetchError = null;
		settingsStore.setProviderConfig(providerId, { baseUrl });
		const config = settingsStore.getProviderConfig(providerId);
		const hasKey = !!config.apiKey;
		const hasUrl = providerId !== 'openai-compatible' || !!baseUrl;
		if (provider && (provider.isLocal || (provider.requiresApiKey && hasKey && hasUrl))) {
			debouncedFetchLLMModels(providerId);
		}
	}

	function handleAllTalkAuthChange(authToken: string) {
		alltalkFetchError = null;
		settingsStore.setProviderConfig('alltalk', { apiKey: authToken });
		debouncedFetchAllTalkSettings();
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
		if (['ollama', 'llamacpp'].includes(provider.id)) {
			debouncedFetchLLMModels(providerId);
		}
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

	function toggleLLM() {
		modulesStore.setModuleEnabled('consciousness', !isLLMEnabled);
	}

	function toggleTTS() {
		modulesStore.setModuleEnabled('speech', !isTTSEnabled);
	}

	async function handleUpload(file: File) {
		await vrmStore.addModel(file);
		uploadModalOpen = false;
	}

	function updateEmotionExpression(emotion: string, expression: string) {
		vrmStore.setEmotionMapping(emotion, { expression });
	}

	function updateEmotionIntensity(emotion: string, value: number) {
		const intensity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
		vrmStore.setEmotionMapping(emotion, { intensity });
	}

	function updateEmotionFadeIn(emotion: string, value: number) {
		const fadeIn = Number.isFinite(value) ? Math.min(3, Math.max(0.05, value)) : 0.25;
		vrmStore.setEmotionMapping(emotion, { fadeIn });
	}

	function updateEmotionFadeOut(emotion: string, value: number) {
		const fadeOut = Number.isFinite(value) ? Math.min(4, Math.max(0.05, value)) : 0.8;
		vrmStore.setEmotionMapping(emotion, { fadeOut });
	}

	function getEmotionConfig(emotion: string): EmotionMapping {
		const profile = vrmStore.emotionProfile;
		return (
			profile?.[emotion] ?? {
				expression: '',
				intensity: 0.5,
				fadeIn: 0.25,
				fadeOut: 0.8
			}
		);
	}

	function requestModeChange(mode: 'companion' | 'dating_sim') {
		if (mode === appMode) return;
		pendingMode = mode;
		modeConfirmOpen = true;
	}

	function confirmModeChange() {
		if (pendingMode) {
			characterStore.setAppMode(pendingMode);
		}
		modeConfirmOpen = false;
		pendingMode = null;
	}

	function cancelModeChange() {
		modeConfirmOpen = false;
		pendingMode = null;
	}
</script>

<div class="character-screen">
	<!-- Header -->
	<header class="screen-header">
		<input
			type="text"
			class="name-input"
			bind:value={formName}
			placeholder="Character Name"
			onblur={saveName}
		/>
	</header>

	<!-- Main Content -->
	<div class="main-content">
		<!-- Left Panel: Character Preview -->
		<div class="character-panel">
			<!-- App Mode Toggle -->
			<div class="mode-section">
				<span class="section-label">App Mode</span>
				<div class="mode-toggle">
					<button
						class="mode-option"
						class:active={appMode === 'companion'}
						onclick={() => requestModeChange('companion')}
					>
						<Icon name="sparkles" size={14} />
						Companion
					</button>
					<button
						class="mode-option"
						class:active={appMode === 'dating_sim'}
						onclick={() => requestModeChange('dating_sim')}
					>
						<Icon name="heart" size={14} />
						Dating Sim
					</button>
				</div>
			</div>

			<!-- Model Gallery (inline) -->
			<div class="model-gallery">
				<div class="gallery-header">
					<span class="gallery-label">Avatar</span>
					<button class="upload-btn" onclick={() => uploadModalOpen = true}>
						<Icon name="upload" size={14} />
						<span>Add Custom</span>
					</button>
				</div>

				<div class="gallery-grid">
					{#each vrmStore.models as model (model.id)}
						<button
							class="model-card"
							class:active={model.id === vrmStore.activeModelId}
							onclick={() => vrmStore.setActiveModel(model.id)}
						>
							<div class="model-preview">
								{#if model.previewUrl}
									<img src={model.previewUrl} alt={model.name} />
								{:else}
									<Icon name="user" size={24} />
								{/if}
								{#if model.id === vrmStore.activeModelId}
									<div class="active-check">
										<Icon name="check" size={12} strokeWidth={3} />
									</div>
								{/if}
							</div>
							<span class="model-name">{model.name}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="personality-section expression-mapping-section">
				<button class="personality-toggle expression-toggle" onclick={() => expressionMappingExpanded = !expressionMappingExpanded}>
					<Icon name="settings" size={16} />
					<span>Expression Mapping (per Avatar)</span>
					<Icon name={expressionMappingExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
				</button>

				{#if expressionMappingExpanded}
					<div class="personality-content expression-content">
						<div class="expression-content-actions">
							<button class="upload-btn" onclick={() => vrmStore.resetEmotionMappingsForActiveModel()}>
								<Icon name="refresh-cw" size={14} />
								<span>Reset Auto</span>
							</button>
						</div>

						{#if vrmStore.availableExpressions.length === 0}
							<p class="expression-empty">
								No expressions detected yet. Select the avatar and wait until it loads in the main scene.
							</p>
						{:else}
							<div class="expression-grid">
								<div class="expression-grid-header">Emotion Tag</div>
								<div class="expression-grid-header">VRM Expression</div>
								<div class="expression-grid-header">Intensity</div>
								<div class="expression-grid-header">Fade In / Out (s)</div>

								{#each emotionTags as emotion}
									{@const cfg = getEmotionConfig(emotion)}
									<div class="expression-emotion">[{emotion}]</div>
									<div>
										<select
											class="expression-select"
											value={cfg.expression}
											onchange={(e) => updateEmotionExpression(emotion, e.currentTarget.value)}
										>
											<option value="">(disabled)</option>
											{#each vrmStore.availableExpressions as expr}
												<option value={expr}>{expr}</option>
											{/each}
										</select>
									</div>
									<div class="expression-intensity">
										<input
											type="range"
											min="0"
											max="1"
											step="0.05"
											value={cfg.intensity}
											oninput={(e) =>
												updateEmotionIntensity(emotion, parseFloat(e.currentTarget.value))}
										/>
										<span>{cfg.intensity.toFixed(2)}</span>
									</div>
									<div class="expression-fades">
										<input
											type="number"
											min="0.05"
											max="3"
											step="0.05"
											value={cfg.fadeIn}
											onchange={(e) => updateEmotionFadeIn(emotion, parseFloat(e.currentTarget.value))}
										/>
										<input
											type="number"
											min="0.05"
											max="4"
											step="0.05"
											value={cfg.fadeOut}
											onchange={(e) => updateEmotionFadeOut(emotion, parseFloat(e.currentTarget.value))}
										/>
									</div>
								{/each}
							</div>
							<p class="expression-hint">
								Mappings are saved per avatar model and loaded automatically when switching models.
							</p>
						{/if}
					</div>
				{/if}
			</div>

				<!-- Core Personality (collapsible) -->
			<div class="personality-section">
				<button class="personality-toggle" onclick={() => personalityExpanded = !personalityExpanded}>
					<Icon name="sparkles" size={16} />
					<span>Core Personality</span>
					<Icon name={personalityExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
				</button>
				{#if personalityExpanded}
					<div class="personality-content">
						<!-- Profile selector bar -->
						<div class="profile-bar">
							<div class="profile-selector">
								{#each personalityProfiles as profile}
									{#if editingProfileId === profile.id}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="profile-name-input"
											type="text"
											bind:value={editingProfileName}
											onblur={commitRename}
											onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitRename(); }}
											autofocus
											/>
									{:else}
										<button
											class="profile-tab"
											class:active={activeProfileId === profile.id}
											onclick={() => switchProfile(profile.id)}
											ondblclick={() => startRename(profile)}
											title="Doppelklick zum Umbenennen"
										>{profile.name}</button>
									{/if}
								{/each}
							</div>
							<div class="profile-actions">
								<button class="profile-btn" onclick={addProfile} title="Neues Profil">
									<Icon name="plus" size={13} />
								</button>
								<button
									class="profile-btn danger"
									onclick={() => activeProfile && deleteProfile(activeProfile.id)}
									title="Profil löschen"
									disabled={personalityProfiles.length <= 1}
								>
									<Icon name="trash" size={13} />
								</button>
							</div>
						</div>
						<textarea
							class="personality-textarea"
							bind:value={formSystemPrompt}
							placeholder="Personality traits, speaking style, background..."
							rows="8"
							onblur={saveSystemPrompt}
						></textarea>
					</div>
				{/if}
			</div>

			<!-- AI Services (collapsible) -->
			<div class="services-section">
				<button class="services-toggle" onclick={() => aiServicesExpanded = !aiServicesExpanded}>
					<Icon name="settings" size={16} />
					<span>AI Services</span>
					<Icon name={aiServicesExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
				</button>

				{#if aiServicesExpanded}
					<div class="services-content">
						<!-- LLM Config -->
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
									{#if provider?.requiresApiKey}
										<div class="api-key-row">
											<input
												type="password"
												class="api-key-input"
												class:error={llmFetchError}
												placeholder="API Key"
												value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
												oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value, 'llm')}
												onblur={handleLLMApiKeyBlur}
											/>
										</div>
									{/if}
									{#if provider?.id === 'openai-compatible'}
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												placeholder="https://your-proxy.com/v1"
												value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
												oninput={(e) => handleLLMBaseUrlChange(e.currentTarget.value)}
											/>
										</div>
									{/if}
								{/if}

								{#if consciousnessSettings.activeProvider}
									{@const provider = getLLMProvider(consciousnessSettings.activeProvider as string)}
								{#if provider?.id !== 'ollama' && !provider?.isLocal}
										<ModelDropdown
											models={llmModels}
											value={consciousnessSettings.activeModel as string}
											onSelect={handleLLMModelChange}
											placeholder="Select model..."
											isLoading={llmIsLoading}
											onRefresh={llmHasApiKey ? fetchLLMModels : undefined}
											disabled={!llmHasApiKey}
											disabledMessage={consciousnessSettings.activeProvider === 'openai-compatible' ? 'Enter API key and URL first' : 'Enter API key first'}
										/>
										{#if llmFetchError}
											<p class="provider-note error">{llmFetchError}</p>
										{/if}
									{/if}
								{/if}

								{#if consciousnessSettings.activeProvider}
									{@const provider = getLLMProvider(consciousnessSettings.activeProvider as string)}
								{#if llmSupportsBrowsing && provider}
										<ModelDropdown
											models={llmModels}
											value={consciousnessSettings.activeModel as string}
											onSelect={handleLLMModelChange}
											placeholder={`Select ${provider.name} model...`}
											isLoading={llmIsLoading}
											onRefresh={fetchLLMModels}
										/>
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												class:error={!!llmFetchError}
												placeholder={provider.defaultBaseUrl || 'http://localhost:11434/v1/'}
												value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
												oninput={(e) => handleLLMBaseUrlChange(e.currentTarget.value)}
											/>
										</div>
										{#if llmFetchError}
											<p class="provider-note error">{llmFetchError}</p>
										{/if}
									{:else if provider?.isLocal}
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												placeholder="Model name (e.g., llama3.2:latest)"
												value={consciousnessSettings.activeModel as string ?? ''}
												onchange={(e) => handleLLMModelChange(e.currentTarget.value)}
											/>
										</div>
										<div class="api-key-row">
											<input
												type="text"
												class="api-key-input"
												placeholder={provider.defaultBaseUrl || 'http://localhost:11434/v1/'}
												value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
												oninput={(e) => handleLLMBaseUrlChange(e.currentTarget.value)}
											/>
										</div>
									{/if}
								{/if}

								{#if consciousnessSettings.activeProvider && getLLMProvider(consciousnessSettings.activeProvider as string)?.isLocal}
									{@const provider = getLLMProvider(consciousnessSettings.activeProvider as string)}
									<div class="api-key-row">
										<input
											type="password"
											class="api-key-input"
											placeholder="Auth token (optional)"
											value={settingsStore.getProviderConfig(provider?.id ?? '').apiKey ?? ''}
											oninput={(e) => handleApiKeyChange(provider?.id ?? '', e.currentTarget.value, 'llm')}
											onblur={handleLLMApiKeyBlur}
										/>
									</div>
								{/if}
							{/if}
						</div>

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
												oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value, 'tts')}
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
												oninput={(e) => handleApiKeyChange(provider.id, e.currentTarget.value, 'tts')}
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
											disabledMessage={consciousnessSettings.activeProvider === 'openai-compatible' ? 'Enter API key and URL first' : 'Enter API key first'}
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

									<div class="vad-sensitivity-row">
										<label class="vad-sensitivity-label" for="ps-ov-def-speed">
											Speed
											<span class="vad-value">{(settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultSpeed ?? 1).toFixed(2)}×</span>
										</label>
										<input
											id="ps-ov-def-speed"
											type="range"
											class="vad-slider"
											min="0.5"
											max="2"
											step="0.05"
											value={settingsStore.getProviderConfig('omnivoice').omnivoiceDefaultSpeed ?? 1}
											oninput={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceDefaultSpeed: Number(e.currentTarget.value) })}
										/>
										<div class="vad-hint">Speech rate (0.5 = slow, 1.0 = normal, 2.0 = fast)</div>
									</div>

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
											{/if}
										{/if}

										<div class="vad-sensitivity-row">
											<label class="vad-sensitivity-label" for="ps-ov-alt-speed">
												Speed
												<span class="vad-value">{(settingsStore.getProviderConfig('omnivoice').omnivoiceAltSpeed ?? 1).toFixed(2)}×</span>
											</label>
											<input
												id="ps-ov-alt-speed"
												type="range"
												class="vad-slider"
												min="0.5"
												max="2"
												step="0.05"
												value={settingsStore.getProviderConfig('omnivoice').omnivoiceAltSpeed ?? 1}
												oninput={(e) => settingsStore.setProviderConfig('omnivoice', { omnivoiceAltSpeed: Number(e.currentTarget.value) })}
											/>
											<div class="vad-hint">Speech rate for the alternative speaker</div>
										</div>
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

						<!-- STT Config -->
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
								<div class="vad-sensitivity-row">
									<span class="vad-sensitivity-label">
										Mic Sensitivity
										<span class="vad-value">{Math.round((1 - ((settingsStore.getProviderConfig('whisper-local').vadThreshold ?? 0.015) - 0.005) / 0.045) * 100)}%</span>
									</span>
									<input
										type="range"
										class="vad-slider"
										min="5"
										max="45"
										step="1"
										value={Math.round((1 - ((settingsStore.getProviderConfig('whisper-local').vadThreshold ?? 0.015) - 0.005) / 0.045) * 100)}
										oninput={(e) => {
											const pct = Number(e.currentTarget.value) / 100;
											const threshold = +(0.05 - pct * 0.045).toFixed(4);
											settingsStore.setProviderConfig('whisper-local', { vadThreshold: threshold });
										}}
									/>
									<div class="vad-hint">Higher = detects quieter speech. Lower = ignores background noise.</div>
								</div>
							{:else if settingsStore.getProviderConfig('stt-config').activeProvider === 'web-speech'}
								<p class="stt-hint">Browser built-in speech recognition. Works in Chrome/Edge without any API key. Not available in Tauri desktop builds.</p>
							{:else}
								<p class="stt-hint">Select a voice input provider above. Local Whisper uses your Docker service on port 8000 — no API key needed.</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Right Panel: Stats -->
		<div class="stats-panel">
			{#if isCharacterLoading}
				<div class="loading-stats">Loading character data...</div>
			{/if}

			{#if isDatingSimMode}
				<!-- Bond Progress (Dating Sim Mode only) - Sims-style glossy bar -->
				<div class="bond-section">
					<div class="bond-progress">
						<div class="bond-header">
							<Tooltip content="Overall affection level. Grows through positive interactions, compliments, and time spent together." side="left">
								<div class="bond-icon">
									<Icon name="heart" size={18} />
								</div>
							</Tooltip>
							<div class="bond-info">
								<span class="bond-tier">{stageInfo.name}</span>
								<span class="bond-description">{stageInfo.description}</span>
							</div>
							<span class="bond-percent">{affectionPercent}%</span>
						</div>
						<div class="bond-bar-track">
							<div class="bond-bar-fill" style="width: {affectionPercent}%">
								<div class="bond-bar-shine"></div>
							</div>
							<div class="bond-bar-markers">
								{#each [25, 50, 75] as marker}
									<div class="bond-marker" style="left: {marker}%"></div>
								{/each}
							</div>
						</div>
					</div>
				</div>

				<!-- Relationship Stats (Dating Sim Mode only) - Sims-style vertical bars -->
				<div class="stats-section">
					<Tooltip content="Core relationship attributes that evolve based on your interactions.">
						<span class="section-label">Relationship Stats</span>
					</Tooltip>
					<div class="sims-stat-bars">
						<Tooltip content="How much she relies on and believes in you. Built through honesty and keeping promises.">
							<div class="sims-stat" style="--bar-color: #4dd0ff; --bar-glow: rgba(77, 208, 255, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.trust}%">
										<div class="sims-bar-shine"></div>
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="shield" size={14} />
								</div>
								<span class="sims-stat-label">Trust</span>
							</div>
						</Tooltip>
						<Tooltip content="Emotional closeness and vulnerability. Grows from meaningful conversations and shared experiences.">
							<div class="sims-stat" style="--bar-color: #c084fc; --bar-glow: rgba(192, 132, 252, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.intimacy}%">
										<div class="sims-bar-shine"></div>
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="heart" size={14} />
								</div>
								<span class="sims-stat-label">Intimacy</span>
							</div>
						</Tooltip>
						<Tooltip content="How at ease she feels around you. Increases with consistent, supportive presence.">
							<div class="sims-stat" style="--bar-color: #4ade80; --bar-glow: rgba(74, 222, 128, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.comfort}%">
										<div class="sims-bar-shine"></div>
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="home" size={14} />
								</div>
								<span class="sims-stat-label">Comfort</span>
							</div>
						</Tooltip>
						<Tooltip content="How much she admires and values you. Earned through thoughtful actions and integrity.">
							<div class="sims-stat" style="--bar-color: #60a5fa; --bar-glow: rgba(96, 165, 250, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.respect}%">
										<div class="sims-bar-shine"></div>
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="award" size={14} />
								</div>
								<span class="sims-stat-label">Respect</span>
							</div>
						</Tooltip>
						<Tooltip content="Her current energy level. Affects mood and responsiveness. Replenishes over time.">
							<div class="sims-stat" style="--bar-color: #fbbf24; --bar-glow: rgba(251, 191, 36, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.energy}%">
										<div class="sims-bar-shine"></div>
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="zap" size={14} />
								</div>
								<span class="sims-stat-label">Energy</span>
							</div>
						</Tooltip>
					</div>
				</div>
			{:else}
				<!-- Companion Mode: Simplified stats -->
				<div class="companion-mode-section">
					<div class="companion-badge">
						<Icon name="sparkles" size={20} />
						<span>Companion Mode</span>
					</div>
					<p class="companion-description">Relationship stats and events are disabled. Only mood and energy are tracked.</p>
				</div>

				<!-- Energy bar (Companion Mode) - Sims-style -->
				<div class="stats-section companion-energy">
					<span class="section-label">Energy</span>
					<div class="sims-stat-bars single">
						<div class="sims-stat" style="--bar-color: #fbbf24; --bar-glow: rgba(251, 191, 36, 0.5)">
							<div class="sims-bar-track tall">
								<div class="sims-bar-fill" style="height: {charState.energy}%">
									<div class="sims-bar-shine"></div>
								</div>
							</div>
							<div class="sims-stat-icon">
								<Icon name="zap" size={16} />
							</div>
							<span class="sims-stat-label">Energy</span>
						</div>
					</div>
				</div>
			{/if}

			<!-- Mood - Sims-style glossy card -->
			<div class="mood-section">
				<Tooltip content="Her emotional state right now, influenced by recent interactions and events.">
					<span class="section-label">Current Mood</span>
				</Tooltip>
				<div class="mood-card" style="--mood-color: {moodInfo.color}">
					<div class="mood-icon-badge">
						<Icon name={moodInfo.icon} size={24} />
						<div class="mood-icon-shine"></div>
					</div>
					<div class="mood-info">
						<span class="mood-name">{moodInfo.description}</span>
						{#if charState.mood.causes.length > 0}
							<span class="mood-cause">{charState.mood.causes[charState.mood.causes.length - 1]}</span>
						{/if}
					</div>
					<div class="mood-indicator">
						<div class="mood-pulse"></div>
					</div>
				</div>
			</div>

			<!-- Activity - Sims-style stat tiles -->
			<div class="activity-section">
				<span class="section-label">Activity</span>
				<div class="activity-grid">
					<div class="activity-tile" style="--tile-color: #ff8f3f; --tile-glow: rgba(255, 143, 63, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="flame" size={16} />
						</div>
						<span class="activity-tile-value">{charState.currentStreak}</span>
						<span class="activity-tile-label">Streak</span>
					</div>
					<div class="activity-tile" style="--tile-color: #fbbf24; --tile-glow: rgba(251, 191, 36, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="trophy" size={16} />
						</div>
						<span class="activity-tile-value">{charState.longestStreak}</span>
						<span class="activity-tile-label">Best</span>
					</div>
					<div class="activity-tile" style="--tile-color: #4dd0ff; --tile-glow: rgba(77, 208, 255, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="message-circle" size={16} />
						</div>
						<span class="activity-tile-value">{charState.totalInteractions}</span>
						<span class="activity-tile-label">Chats</span>
					</div>
					<div class="activity-tile" style="--tile-color: #4ade80; --tile-glow: rgba(74, 222, 128, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="calendar" size={16} />
						</div>
						<span class="activity-tile-value">{charState.daysKnown}</span>
						<span class="activity-tile-label">Days</span>
					</div>
				</div>
			</div>

			<!-- Events (Dating Sim Mode only, collapsible) - Sims-style achievements -->
			{#if isDatingSimMode}
				<div class="events-section">
					<button class="events-toggle" onclick={() => eventsExpanded = !eventsExpanded}>
						<div class="events-toggle-icon">
							<Icon name="star" size={16} />
						</div>
						<span>Achievements</span>
						{#if achievements.length > 0}
							<span class="events-count">{achievements.length}</span>
						{/if}
						<Icon name={eventsExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
					</button>

					{#if eventsExpanded}
						<div class="events-content">
							{#if achievements.length > 0}
								<div class="events-list">
									{#each achievements as achievement, i}
										{@const config = achievementConfig[achievement.type]}
										<div
											class="achievement-card"
											style="--event-color: {config.color}; --event-bg: {config.bgColor}; --delay: {i}"
										>
											<div class="achievement-badge">
												<Icon name={config.icon} size={18} />
												<div class="achievement-badge-shine"></div>
											</div>
											<div class="achievement-info">
												<span class="achievement-name">{achievement.name}</span>
												<div class="achievement-meta">
													<span class="achievement-type">{config.label}</span>
													<span class="achievement-date">{formatAchievementDate(achievement.completedAt)}</span>
												</div>
											</div>
											<div class="achievement-check">
												<Icon name="check" size={14} strokeWidth={3} />
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<div class="events-empty">
									<div class="empty-icon">
										<Icon name="sparkles" size={28} />
									</div>
									<span class="empty-title">No achievements yet</span>
									<span class="empty-hint">Keep chatting to unlock special moments!</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Upload Modal -->
	{#if uploadModalOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="upload-modal" onclick={() => uploadModalOpen = false} onkeydown={() => {}}>
			<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
			<div class="upload-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				<div class="upload-header">
					<h3>Upload Custom Model</h3>
					<button class="close-btn" onclick={() => uploadModalOpen = false} onkeydown={() => {}}>
						<Icon name="x" size={20} />
					</button>
				</div>
				<VrmUploader onUpload={handleUpload} />
			</div>
		</div>
	{/if}

	<!-- Mode Change Confirmation Modal -->
	{#if modeConfirmOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="confirm-modal" onclick={cancelModeChange} onkeydown={() => {}}>
			<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
			<div class="confirm-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				<div class="confirm-icon">
					<Icon name="alert" size={32} />
				</div>
				<h3 class="confirm-title">Switch Mode?</h3>
				<p class="confirm-message">
					Switching modes frequently can lead to unexpected results and disrupt natural progression. Are you sure you want to continue?
				</p>
				<div class="confirm-actions">
					<button class="confirm-btn confirm-btn--cancel" onclick={cancelModeChange} onkeydown={() => {}}>
						Cancel
					</button>
					<button class="confirm-btn confirm-btn--confirm" onclick={confirmModeChange}>
						Switch Mode
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.character-screen {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Header */
	.screen-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		margin-bottom: 1rem;
		flex-shrink: 0;
	}

	:global(.dark) .screen-header {
		border-bottom-color: rgba(255, 255, 255, 0.08);
	}

	.name-input {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.25rem 0;
		width: auto;
		min-width: 120px;
		max-width: 280px;
		transition: all 0.15s ease-out;
	}

	.name-input:hover {
		border-bottom-color: rgba(1, 178, 255, 0.2);
	}

	.name-input:focus {
		outline: none;
		border-bottom: 2px solid #01B2FF;
		background: linear-gradient(180deg, rgba(1, 178, 255, 0.05) 0%, transparent 100%);
	}

	/* Main Content */
	.main-content {
		flex: 1;
		display: flex;
		gap: 1.5rem;
		min-height: 0;
		overflow: hidden;
	}

	/* Character Panel (Left) */
	.character-panel {
		flex: 1 1 55%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
	}

	.character-panel > * {
		flex-shrink: 0;
	}

	/* Mode Section */
	.mode-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-light);
	}

	.mode-toggle {
		display: flex;
		gap: 0.5rem;
	}

	.mode-option {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 2px solid rgba(0, 0, 0, 0.08);
		border-radius: 12px;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .mode-option {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.mode-option:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .mode-option:hover {
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.mode-option.active {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border-color: rgba(0, 0, 0, 0.1);
		color: white;
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	:global(.dark) .mode-option.active {
		box-shadow:
			0 3px 12px rgba(1, 178, 255, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
	}

	/* Companion Mode Section */
	.companion-mode-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem;
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border: 1px solid rgba(1, 178, 255, 0.2);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .companion-mode-section {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.25);
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.companion-badge {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border-radius: 2rem;
		color: white;
		font-weight: 600;
		font-size: 0.875rem;
		box-shadow:
			0 2px 8px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.companion-description {
		margin: 0;
		text-align: center;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	/* Model Gallery */
	.model-gallery {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.gallery-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.gallery-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
	}

	.upload-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .upload-btn {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.upload-btn:hover {
		transform: translateY(-1px);
		border-color: rgba(1, 178, 255, 0.3);
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .upload-btn:hover {
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 0.75rem;
	}

	.model-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 2px solid rgba(0, 0, 0, 0.06);
		border-radius: 14px;
		cursor: pointer;
		transition: all 0.15s ease-out;
		opacity: 0.8;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .model-card {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.model-card:hover {
		opacity: 1;
		transform: translateY(-2px);
		box-shadow:
			0 6px 16px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .model-card:hover {
		box-shadow:
			0 6px 16px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.model-card.active {
		border-color: rgba(1, 178, 255, 0.5);
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		opacity: 1;
		box-shadow:
			0 4px 12px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	:global(.dark) .model-card.active {
		box-shadow:
			0 4px 14px rgba(1, 178, 255, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
	}

	.model-card.active .model-name {
		color: white;
	}

	.model-card.active .model-preview {
		background: rgba(255, 255, 255, 0.2);
		color: white;
	}

	.model-preview {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		background: linear-gradient(180deg, #f0f0f0 0%, #e5e5e5 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 10px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	:global(.dark) .model-preview {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
	}

	.model-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.active-check {
		position: absolute;
		top: 0.375rem;
		right: 0.375rem;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		color: #01B2FF;
		border-radius: 50%;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	.model-name {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.expression-content {
		padding: 0 1rem 1rem;
	}



	.expression-content-actions {
		display: flex;
		justify-content: flex-end;
	}

	.expression-grid {
		display: grid;
		grid-template-columns: 0.9fr 1.4fr 1fr 1fr;
		gap: 0.4rem 0.6rem;
		align-items: center;
	}

	.expression-grid-header {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		padding-bottom: 0.2rem;
		border-bottom: 1px solid var(--border-light);
	}

	.expression-emotion {
		font-family: 'Share Tech Mono', monospace;
		font-size: 0.76rem;
		color: var(--text-secondary);
	}

	.expression-select,
	.expression-fades input {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-light);
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 0.75rem;
	}

	.expression-intensity {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.expression-intensity input[type='range'] {
		flex: 1;
	}

	.expression-intensity span {
		min-width: 2.2rem;
		text-align: right;
		font-size: 0.72rem;
		color: var(--text-tertiary);
		font-family: 'Share Tech Mono', monospace;
	}

	.expression-fades {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}

	.expression-hint,
	.expression-empty {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	/* Personality Section */
	.personality-section {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		overflow: hidden;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .personality-section {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.personality-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	.personality-toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .personality-toggle:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.personality-toggle span {
		flex: 1;
		text-align: left;
	}

	.personality-content {
		padding: 0 1rem 1rem;
	}

	.profile-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}

	.profile-selector {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		flex: 1;
	}

	.profile-tab {
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, rgba(0,0,0,0.12));
		background: transparent;
		font-size: 0.72rem;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.profile-tab:hover {
		background: rgba(1, 178, 255, 0.08);
		color: var(--text-primary);
	}

	.profile-tab.active {
		background: #01B2FF;
		color: #fff;
		border-color: #01B2FF;
		font-weight: 600;
	}

	.profile-name-input {
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
		border: 1px solid #01B2FF;
		background: transparent;
		font-size: 0.72rem;
		color: var(--text-primary);
		min-width: 80px;
		outline: none;
	}

	.profile-actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.profile-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 5px;
		border: 1px solid var(--border-color, rgba(0,0,0,0.12));
		background: transparent;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background 0.15s;
	}

	.profile-btn:hover:not(:disabled) {
		background: rgba(1, 178, 255, 0.1);
		color: #01B2FF;
	}

	.profile-btn.danger:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.profile-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.personality-textarea {
		width: 100%;
		padding: 0.75rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--text-primary);
		resize: vertical;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.06),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .personality-textarea {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.personality-textarea:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			0 0 0 3px rgba(1, 178, 255, 0.15),
			inset 0 1px 3px rgba(0, 0, 0, 0.06);
	}

	/* Stats Panel (Right) */
	.stats-panel {
		flex: 1 1 45%;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
	}

	.stats-panel > * {
		flex-shrink: 0;
	}

	.loading-stats {
		padding: 1.25rem;
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.875rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 14px;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .loading-stats {
		background: linear-gradient(180deg, #252525 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.section-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	/* Bond Section - Sims-style glossy */
	.bond-section {
		padding: 1.25rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.98) 0%,
			rgba(250, 250, 252, 0.95) 50%,
			rgba(245, 245, 248, 0.98) 100%
		);
		border-radius: 16px;
		border: 1px solid rgba(255, 107, 157, 0.2);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.04),
			0 4px 16px rgba(255, 107, 157, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 1);
	}

	:global(.dark) .bond-section {
		background: linear-gradient(
			180deg,
			rgba(45, 45, 50, 0.98) 0%,
			rgba(38, 38, 42, 0.95) 50%,
			rgba(32, 32, 36, 0.98) 100%
		);
		border-color: rgba(255, 107, 157, 0.25);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.2),
			0 4px 16px rgba(255, 107, 157, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.bond-progress {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.bond-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.bond-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: linear-gradient(180deg, #ff8faf 0%, #ff6b9d 50%, #e85a8a 100%);
		border-radius: 10px;
		color: white;
		box-shadow:
			0 4px 12px rgba(255, 107, 157, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
		filter: drop-shadow(0 0 6px rgba(255, 107, 157, 0.4));
	}

	.bond-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.bond-tier {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.bond-description {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.bond-percent {
		font-size: 1.25rem;
		font-weight: 700;
		color: #ff6b9d;
		text-shadow: 0 0 12px rgba(255, 107, 157, 0.3);
	}

	.bond-bar-track {
		position: relative;
		height: 14px;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.1) 0%,
			rgba(0, 0, 0, 0.06) 50%,
			rgba(0, 0, 0, 0.08) 100%
		);
		border-radius: 7px;
		overflow: hidden;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.1),
			0 1px 0 rgba(255, 255, 255, 0.5);
	}

	:global(.dark) .bond-bar-track {
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.35) 0%,
			rgba(0, 0, 0, 0.25) 50%,
			rgba(0, 0, 0, 0.3) 100%
		);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.bond-bar-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: linear-gradient(
			180deg,
			#ffb3c9 0%,
			#ff8faf 25%,
			#ff6b9d 60%,
			#e85a8a 100%
		);
		border-radius: 7px;
		transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow:
			0 0 16px rgba(255, 107, 157, 0.5),
			0 0 6px rgba(255, 107, 157, 0.4),
			inset 0 0 0 1px rgba(255, 255, 255, 0.3);
	}

	.bond-bar-shine {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.5) 0%,
			rgba(255, 255, 255, 0) 100%
		);
		border-radius: 7px 7px 0 0;
		pointer-events: none;
	}

	.bond-bar-markers {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
	}

	.bond-marker {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(0, 0, 0, 0.1);
	}

	:global(.dark) .bond-marker {
		background: rgba(255, 255, 255, 0.1);
	}

	/* Stats Section */
	.stats-section {
		padding: 1rem 1.25rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .stats-section {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	/* Sims-style Vertical Stat Bars */
	.sims-stat-bars {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.sims-stat-bars.single {
		justify-content: center;
	}

	.sims-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}

	.sims-bar-track {
		width: 22px;
		height: 80px;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.15) 0%,
			rgba(0, 0, 0, 0.1) 50%,
			rgba(0, 0, 0, 0.08) 100%
		);
		border-radius: 11px;
		position: relative;
		overflow: hidden;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.15),
			inset 0 0 0 1px rgba(0, 0, 0, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.5);
	}

	.sims-bar-track.tall {
		height: 100px;
		width: 28px;
		border-radius: 14px;
	}

	:global(.dark) .sims-bar-track {
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.4) 0%,
			rgba(0, 0, 0, 0.3) 50%,
			rgba(0, 0, 0, 0.25) 100%
		);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.4),
			inset 0 0 0 1px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.sims-bar-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--bar-color) 100%, white 30%) 0%,
			var(--bar-color) 40%,
			color-mix(in srgb, var(--bar-color) 100%, black 15%) 100%
		);
		border-radius: 9px;
		transition: height 0.5s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow:
			0 0 12px var(--bar-glow),
			0 0 4px var(--bar-glow),
			inset 0 0 0 1px rgba(255, 255, 255, 0.3);
	}

	.sims-bar-shine {
		position: absolute;
		top: 0;
		left: 2px;
		right: 50%;
		height: 100%;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.4) 0%,
			rgba(255, 255, 255, 0.1) 100%
		);
		border-radius: 7px 0 0 7px;
		pointer-events: none;
	}

	.sims-stat-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border-radius: 8px;
		color: var(--bar-color);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		filter: drop-shadow(0 0 3px var(--bar-glow));
	}

	:global(.dark) .sims-stat-icon {
		background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.sims-stat-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-tertiary);
	}

	.companion-energy {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.companion-energy .sims-stat-bars {
		width: 100%;
	}

	/* Mood Section - Sims-style glossy card */
	.mood-section {
		padding: 1rem 1.25rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.98) 0%,
			rgba(250, 250, 252, 0.95) 50%,
			rgba(245, 245, 248, 0.98) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 16px;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.04),
			0 4px 16px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 1);
	}

	:global(.dark) .mood-section {
		background: linear-gradient(
			180deg,
			rgba(45, 45, 50, 0.98) 0%,
			rgba(38, 38, 42, 0.95) 50%,
			rgba(32, 32, 36, 0.98) 100%
		);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.2),
			0 4px 16px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.mood-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.8) 0%,
			rgba(250, 250, 252, 0.6) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.04);
		border-radius: 12px;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.8),
			0 2px 8px rgba(0, 0, 0, 0.04);
	}

	:global(.dark) .mood-card {
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.06) 0%,
			rgba(255, 255, 255, 0.03) 100%
		);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.05),
			0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.mood-icon-badge {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--mood-color) 80%, white 40%) 0%,
			var(--mood-color) 50%,
			color-mix(in srgb, var(--mood-color) 80%, black 20%) 100%
		);
		border-radius: 12px;
		color: white;
		flex-shrink: 0;
		box-shadow:
			0 4px 12px color-mix(in srgb, var(--mood-color) 50%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}

	.mood-icon-shine {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.4) 0%,
			rgba(255, 255, 255, 0) 100%
		);
		border-radius: 12px 12px 0 0;
		pointer-events: none;
	}

	.mood-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.mood-name {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.mood-cause {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	.mood-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mood-pulse {
		width: 10px;
		height: 10px;
		background: var(--mood-color);
		border-radius: 50%;
		animation: mood-pulse 2s ease-in-out infinite;
		box-shadow: 0 0 8px var(--mood-color);
	}

	@keyframes mood-pulse {
		0%, 100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.2);
			opacity: 0.7;
		}
	}

	/* Activity Section - Sims-style stat tiles */
	.activity-section {
		padding: 1rem 1.25rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.98) 0%,
			rgba(250, 250, 252, 0.95) 50%,
			rgba(245, 245, 248, 0.98) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 16px;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.04),
			0 4px 16px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 1);
	}

	:global(.dark) .activity-section {
		background: linear-gradient(
			180deg,
			rgba(45, 45, 50, 0.98) 0%,
			rgba(38, 38, 42, 0.95) 50%,
			rgba(32, 32, 36, 0.98) 100%
		);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.2),
			0 4px 16px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.activity-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.625rem;
	}

	.activity-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 0.875rem 0.5rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.9) 0%,
			rgba(250, 250, 252, 0.8) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.04);
		border-radius: 14px;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .activity-tile {
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.08) 0%,
			rgba(255, 255, 255, 0.04) 100%
		);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.activity-tile:hover {
		transform: translateY(-3px);
		box-shadow:
			0 6px 16px var(--tile-glow),
			0 4px 8px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .activity-tile:hover {
		box-shadow:
			0 6px 16px var(--tile-glow),
			0 4px 8px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.activity-tile-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--tile-color) 80%, white 40%) 0%,
			var(--tile-color) 50%,
			color-mix(in srgb, var(--tile-color) 80%, black 20%) 100%
		);
		border-radius: 10px;
		color: white;
		box-shadow:
			0 3px 8px var(--tile-glow),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
	}

	.activity-tile-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.2;
	}

	.activity-tile-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-tertiary);
	}

	/* Events/Achievements Section - Sims-style */
	.events-section {
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.98) 0%,
			rgba(250, 250, 252, 0.95) 50%,
			rgba(245, 245, 248, 0.98) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 16px;
		overflow: hidden;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.04),
			0 4px 16px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 1);
	}

	:global(.dark) .events-section {
		background: linear-gradient(
			180deg,
			rgba(45, 45, 50, 0.98) 0%,
			rgba(38, 38, 42, 0.95) 50%,
			rgba(32, 32, 36, 0.98) 100%
		);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.2),
			0 4px 16px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.events-toggle {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 1rem 1.25rem;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	.events-toggle:hover {
		background: rgba(0, 0, 0, 0.02);
	}

	:global(.dark) .events-toggle:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.events-toggle-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: linear-gradient(180deg, #ffd966 0%, #fbbf24 50%, #f59e0b 100%);
		border-radius: 8px;
		color: white;
		box-shadow:
			0 3px 8px rgba(251, 191, 36, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
	}

	.events-toggle span {
		flex: 1;
		text-align: left;
	}

	.events-count {
		font-size: 0.7rem;
		font-weight: 700;
		color: white;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		padding: 0.25rem 0.625rem;
		border-radius: 1rem;
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.events-content {
		padding: 0 1rem 1.25rem;
	}

	.events-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.achievement-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.9) 0%,
			rgba(250, 250, 252, 0.8) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.04);
		border-radius: 14px;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		animation: achievement-slide 0.3s ease-out backwards;
		animation-delay: calc(var(--delay) * 50ms);
	}

	@keyframes achievement-slide {
		from {
			opacity: 0;
			transform: translateX(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	:global(.dark) .achievement-card {
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.08) 0%,
			rgba(255, 255, 255, 0.04) 100%
		);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.achievement-card:hover {
		transform: translateY(-2px) translateX(4px);
		box-shadow:
			0 6px 16px color-mix(in srgb, var(--event-color) 30%, transparent),
			0 4px 8px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .achievement-card:hover {
		box-shadow:
			0 6px 16px color-mix(in srgb, var(--event-color) 30%, transparent),
			0 4px 8px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.achievement-badge {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--event-color) 80%, white 40%) 0%,
			var(--event-color) 50%,
			color-mix(in srgb, var(--event-color) 80%, black 20%) 100%
		);
		border-radius: 12px;
		color: white;
		flex-shrink: 0;
		box-shadow:
			0 4px 12px color-mix(in srgb, var(--event-color) 50%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}

	.achievement-badge-shine {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.4) 0%,
			rgba(255, 255, 255, 0) 100%
		);
		border-radius: 12px 12px 0 0;
		pointer-events: none;
	}

	.achievement-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.achievement-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.achievement-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
	}

	.achievement-type {
		color: var(--event-color);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.achievement-date {
		color: var(--text-tertiary);
	}

	.achievement-date::before {
		content: '•';
		margin-right: 0.5rem;
		opacity: 0.5;
	}

	.achievement-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: linear-gradient(180deg, #4ade80 0%, #22c55e 50%, #16a34a 100%);
		border-radius: 50%;
		color: white;
		flex-shrink: 0;
		box-shadow:
			0 3px 8px rgba(34, 197, 94, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	.events-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.625rem;
		padding: 2rem 1rem;
		text-align: center;
	}

	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.04) 0%,
			rgba(0, 0, 0, 0.02) 100%
		);
		border-radius: 16px;
		color: var(--text-tertiary);
	}

	:global(.dark) .empty-icon {
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.06) 0%,
			rgba(255, 255, 255, 0.03) 100%
		);
	}

	.empty-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.empty-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}


	.events-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.5rem 1rem;
		color: #01B2FF;
		text-align: center;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px dashed rgba(1, 178, 255, 0.3);
		border-radius: 12px;
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.04);
	}

	:global(.dark) .events-empty {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(1, 178, 255, 0.25);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15);
	}

	.events-empty span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	/* AI Services Section */
	.services-section {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		overflow: hidden;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .services-section {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.services-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	.services-toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .services-toggle:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.services-toggle span {
		flex: 1;
		text-align: left;
	}

	.services-content {
		padding: 0 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
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

	/* Upload Modal */
	.upload-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 2rem;
	}

	.upload-content {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 16px;
		max-width: 400px;
		width: 100%;
		overflow: hidden;
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.2),
			0 8px 20px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .upload-content {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.4),
			0 8px 20px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.upload-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}

	:global(.dark) .upload-header {
		border-bottom-color: rgba(255, 255, 255, 0.08);
	}

	.upload-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: linear-gradient(180deg, #f8f8f8 0%, #eeeeee 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		color: var(--text-secondary);
		cursor: pointer;
		border-radius: 10px;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .close-btn {
		background: linear-gradient(180deg, #333333 0%, #282828 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.close-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 8px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .close-btn:hover {
		box-shadow:
			0 4px 8px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.upload-content :global(.uploader) {
		margin: 1rem;
		aspect-ratio: auto;
		min-height: 200px;
	}

	/* Confirmation Modal */
	.confirm-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 2rem;
	}

	.confirm-content {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 16px;
		max-width: 360px;
		width: 100%;
		padding: 1.5rem;
		text-align: center;
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.2),
			0 8px 20px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .confirm-content {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.4),
			0 8px 20px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.confirm-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border: 1px solid rgba(1, 178, 255, 0.2);
		border-radius: 50%;
		color: #01B2FF;
		margin-bottom: 1rem;
		box-shadow:
			0 4px 12px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .confirm-icon {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.25);
		box-shadow:
			0 4px 12px rgba(1, 178, 255, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.confirm-title {
		margin: 0 0 0.75rem;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.confirm-message {
		margin: 0 0 1.5rem;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
	}

	.confirm-btn {
		flex: 1;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	.confirm-btn--cancel {
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		color: var(--text-secondary);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .confirm-btn--cancel {
		background: linear-gradient(180deg, #333333 0%, #282828 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.confirm-btn--cancel:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .confirm-btn--cancel:hover {
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.confirm-btn--confirm {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		color: white;
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.confirm-btn--confirm:hover {
		transform: translateY(-1px);
		box-shadow:
			0 6px 16px rgba(1, 178, 255, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	/* Mobile */
	@media (max-width: 900px) {
		.name-input {
			font-size: 1.25rem;
		}

		.main-content {
			flex-direction: column;
			overflow-y: auto;
		}

		.character-panel {
			flex: none;
		}

		.gallery-grid {
			grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		}

		.expression-grid {
			grid-template-columns: 1fr;
		}

		.expression-grid-header {
			display: none;
		}

		.expression-emotion {
			margin-top: 0.35rem;
			font-weight: 600;
		}

		.stats-panel {
			flex: none;
			overflow: visible;
		}

		.activity-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.gallery-grid {
			grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
			gap: 0.5rem;
		}

		.model-card {
			padding: 0.5rem;
		}

		.model-name {
			font-size: 0.7rem;
		}
	}
</style>

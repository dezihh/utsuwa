<script lang="ts">
	import VrmScene from '$lib/components/vrm/VrmScene.svelte';
	import CompanionStatus from '$lib/components/ui/CompanionStatus.svelte';
	import FloatingStatIndicators from '$lib/components/ui/FloatingStatIndicators.svelte';
	import { TopRightButtons, TopLeftButtons, InfoModal, ImageSearchModal } from '$lib/components/ui';
	import BottomChatBar from '$lib/components/chat/BottomChatBar.svelte';
	import SpeechBubble from '$lib/components/chat/SpeechBubble.svelte';
	import ChatSidebar from '$lib/components/chat/ChatSidebar.svelte';
	import DebugPanel from '$lib/components/debug/DebugPanel.svelte';
	import { EventScene } from '$lib/components/events';
	import { OnboardingModal } from '$lib/components/onboarding';
	import MemoryGraphModal from '$lib/components/memory/MemoryGraphModal.svelte';
	import FactLibraryModal from '$lib/components/memory/FactLibraryModal.svelte';
	import MemoryInspectorModal from '$lib/components/memory/MemoryInspectorModal.svelte';
	import VocabularyModal from '$lib/components/vocabulary/VocabularyModal.svelte';
	import EvolutionConfirmModal from '$lib/components/ui/EvolutionConfirmModal.svelte';
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import { expressionController } from '$lib/services/vrm/expression-controller';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { ttsStore } from '$lib/stores/tts.svelte';
	import { duplexStore, startDuplex, stopDuplex, onTTSStarted, onTTSDone } from '$lib/stores/duplex.svelte';
	import { displayStore } from '$lib/stores/display.svelte';
	import { startWaitTone, stopWaitTone } from '$lib/utils/wait-tone';
	import { characterStore } from '$lib/stores/character.svelte';
	import { personaStore } from '$lib/stores/persona.svelte';
	import { debugEventsStore } from '$lib/stores/debugEvents.svelte';
	import { getLLMProvider, getTTSProvider } from '$lib/services/providers/registry';
	import { streamChatDirect } from '$lib/services/chat/client-chat';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { isTauri } from '$lib/services/platform';
	import type { TTSProvider } from '$lib/types';
	import type { StateUpdates } from '$lib/types/character';
	import type { EventDefinition, EventType } from '$lib/types/events';
	import { onMount } from 'svelte';

	// V2 companion system imports
	import { buildSystemPrompt, type PromptContext } from '$lib/ai/prompt-builder';
	import { parseResponse, validateStateUpdates, extractPotentialFacts } from '$lib/ai/response-parser';
	import { calculateBaselineUpdates, analyzeMessage } from '$lib/engine/heuristics';
	import { mergeUpdates, checkAndApplyStageTransition } from '$lib/engine/state-updates';
	import type { SpeechSegment } from '$lib/services/voice-orchestrator';
	import {
		retrieveRelevantContext,
		addTurnToWorkingMemory,
		hydrateWorkingMemory,
		clearWorkingMemory,
		getWorkingMemory,
		memoryApi,
		determineFactCategory,
		calculateFactImportance,
		backfillEmbeddings,
		getEmbeddingBackfillStatus,
		shouldStartNewSession,
		startNewSession,
		SHARED_CHARACTER_ID
	} from '$lib/engine/memory';
	import { getMemoryBudget } from '$lib/types/memory';
	import * as memoryStorage from '$lib/services/storage/memory';
	import { initEmbeddingModel, subscribeToEmbeddingState, type EmbeddingState } from '$lib/services/embeddings';
	import { checkAllEvents, eventsApi } from '$lib/engine/events';
	import { allEvents } from '$lib/data/events';
	import { debugStore } from '$lib/stores/debug.svelte';
	import { splitIntoSegments, stripAllTags, stripForApiContext, stripForSpeech, isContinueRequest } from '$lib/utils/sentences';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { tryExtractReminderFromUserMessage } from '$lib/utils/reminders';
	import { extractImageSearchTags, tryExtractDelayedImageSearch, isCloseImageRequest } from '$lib/utils/image-search';
	import { extractReminderTags } from '$lib/utils/reminders';
	import { imageSearchStore } from '$lib/stores/image-search.svelte';
	import { extractVocabTags } from '$lib/utils/vocabulary';
	import * as vocabularyStorage from '$lib/services/storage/vocabulary';
	import { StreamingSpeechBuffer } from '$lib/services/tts/streaming-speech-buffer';
	import type { ProviderConfig } from '$lib/types';

	function buildOmniVoiceDescriptor(cfg: ProviderConfig, isAlt = false): string {
		const type = isAlt ? cfg.omnivoiceAltVoiceType : cfg.omnivoiceDefaultVoiceType;
		if (type === 'clone') {
			return (isAlt ? cfg.omnivoiceAltCloneId : cfg.omnivoiceDefaultCloneId) || '';
		}
		// 'internal' or undefined → design mode with text descriptor.
		// undefined happens when the user never explicitly touched the Voice Type dropdown
		// but the UI shows "Synthetic" as default via ?? 'internal'.
		if (type === 'internal' || type === undefined) {
			const gender = isAlt ? cfg.omnivoiceAltGender : cfg.omnivoiceDefaultGender;
			const age    = isAlt ? cfg.omnivoiceAltAge    : cfg.omnivoiceDefaultAge;
			const pitch  = isAlt ? cfg.omnivoiceAltPitch  : cfg.omnivoiceDefaultPitch;
			const parts  = [gender, age, pitch].filter(Boolean);
			const desc = parts.length > 0 ? parts.join(', ') : 'female';
			// Prefix "instruct:" signals OmniVoice design mode (text descriptor → instruct param)
			// vs clone mode (voice ID lookup). Detected in OmniVoiceTTS.requestStream.
			return `instruct:${desc}`;
		}
		// Alt voice not configured — let caller decide fallback
		return '';
	}

	let canvasRef: HTMLCanvasElement | null = null;

	// Event scene state
	let activeEvent = $state<EventDefinition | null>(null);

	// Info modal state
	let showInfoModal = $state(false);

	// Memory graph modal state
	let showMemoryGraph = $state(false);

	// Fact library modal state
	let showFactLibrary = $state(false);

	// Vocabulary modal state
	let showVocabulary = $state(false);

	// Memory inspector modal state
	let showMemoryInspector = $state(false);

	// Evolution confirmation modal state
	let pendingEvolutionSuggestions = $state<Array<{ adaptation: string; reason: string }> | null>(null);
	let evolutionLanguage = $state<string | undefined>(undefined);

	// Onboarding state
	let showOnboarding = $state(false);
	let onboardingDismissed = $state(false);

	// Working memory reference
	let workingMemory = getWorkingMemory();

	// Speech bubble state
	let latestResponse = $state('');
	let isTyping = $state(false);
	// Sidebar TTS sync: grows sentence-by-sentence as audio plays
	let spokenSoFar = $state('');
	let llmAbortController: AbortController | null = null;
	// Monotonic counter so aborted sends don't overwrite state of the active one.
	let sendGeneration = $state(0);

	// Replay tracking: all segments queued in the current TTS session and the
	// orchestrator index of the last segment that started playing.
	// Used by "setze fort" to replay unspoken content without a new LLM call.
	let sessionSegments: SpeechSegment[] = [];
	let lastPlayedSegmentIndex = -1;

	// Chat sidebar state
	let sidebarOpen = $state(displayStore.chatDisplayMode !== 'bubble');
	const showBubble = $derived(
		displayStore.chatDisplayMode === 'bubble' || displayStore.chatDisplayMode === 'both'
	);
	const showSidebarBtn = $derived(
		displayStore.chatDisplayMode === 'sidebar' || displayStore.chatDisplayMode === 'both'
	);

	// Typing dots visibility — delayed by typingIndicatorDelayMs
	let typingDotsVisible = $state(false);
	$effect(() => {
		if (!isTyping) {
			typingDotsVisible = false;
			return;
		}
		typingDotsVisible = false;
		const delay = displayStore.typingIndicatorDelayMs;
		if (delay <= 0) {
			typingDotsVisible = true;
			return;
		}
		const timer = setTimeout(() => { typingDotsVisible = true; }, delay);
		return () => clearTimeout(timer);
	});

	// Wait tone — starts/stops with typing dots
	$effect(() => {
		if (typingDotsVisible && displayStore.waitToneEnabled) {
			startWaitTone();
		} else {
			stopWaitTone();
		}
	});

	// Derived current character ID from active preset
	const currentCharacterId = $derived(settingsStore.getActiveProfileId());

	// UI language derived from the active TTS provider config
	const uiLanguage = $derived(
		(() => {
			const speechSettings = modulesStore.getModuleSettings('speech');
			const ttsProvider = speechSettings?.activeProvider as string | undefined;
			const cfg = ttsProvider ? settingsStore.getProviderConfig(ttsProvider) : null;
			return (cfg?.language as string | undefined) ?? 'en';
		})()
	);

	// Auto-switch VRM avatar when active preset defines one
	$effect(() => {
		const models = vrmStore.models;
		if (models.length === 0) return;
		const activeProfileId = settingsStore.getActiveProfileId();
		const preset = settingsStore.getPersonalityProfiles().find((p) => p.id === activeProfileId);
		if (preset?.vrmModelId) {
			const model = models.find((m) => m.id === preset.vrmModelId);
			if (model && vrmStore.activeModelId !== preset.vrmModelId) {
				vrmStore.setActiveModel(preset.vrmModelId);
			}
		}
	});

	// Preset switch effect: clear working memory and load character state when preset changes
	let prevProfileId = settingsStore.getActiveProfileId();
	$effect(() => {
		const newId = settingsStore.getActiveProfileId();
		if (newId === prevProfileId) return;
		prevProfileId = newId;
		clearWorkingMemory();
		characterStore.loadState(newId);
		chatStore.clearMessages();
	});

	const SIDEBAR_WIDTH = 320;
	const sidebarEffective = $derived(sidebarOpen && showSidebarBtn);
	const leftOffset = $derived(
		sidebarEffective && displayStore.sidebarPosition === 'left' ? SIDEBAR_WIDTH : 0
	);
	const rightOffset = $derived(
		sidebarEffective && displayStore.sidebarPosition === 'right' ? SIDEBAR_WIDTH : 0
	);

	// Track memory hydration
	let isMemoryReady = $state(false);

	// Track embedding model state
	let embeddingState = $state<EmbeddingState>({ isLoading: false, isReady: false, error: null });

	// Hydrate working memory on start
	$effect(() => {
		isMemoryReady = false;
		(async () => {
			try {
				await hydrateWorkingMemory(currentCharacterId);
				isMemoryReady = true;
			} catch (e) {
				console.error('Failed to hydrate working memory:', e);
				isMemoryReady = true; // Don't block the app
			}
		})();
	});

	// Fetch MCP tools on start so hasActiveTools is correct before first send
	$effect(() => {
		if (mcpStore.enabledServers.length > 0) {
			mcpStore.refreshTools();
		}
	});

	// Initialize embedding model and backfill any facts without embeddings
	$effect(() => {
		const unsub = subscribeToEmbeddingState((state) => {
			embeddingState = state;
		});

		initEmbeddingModel().then(async (ready) => {
			if (ready) {
				const status = await getEmbeddingBackfillStatus();
				if (status.withoutEmbeddings > 0) {
					await backfillEmbeddings();
				}
			}
		}).catch((e) => {
			console.error('Failed to initialize embedding model:', e);
		});

		return unsub;
	});

	// Check for first-run (onboarding)
	$effect(() => {
		if (characterStore.isReady && !onboardingDismissed) {
			const { lastInteraction, totalInteractions } = characterStore.state;
			showOnboarding = lastInteraction === null && totalInteractions === 0;
		}
	});

	// Check for debug events (from developer tools)
	$effect(() => {
		const debugEvent = debugEventsStore.consume();
		if (debugEvent) {
			activeEvent = debugEvent;
		}
	});

	// Start reminder polling and handle fired reminders
	$effect(() => {
		reminderStore.setOnReminderFired(async (reminder) => {
			const content = reminder.content;
			console.log('[Reminder] Fired:', content);

			// Check if this is an image-search reminder
			if (content.startsWith('search_image:')) {
				const query = content.slice('search_image:'.length).trim();
				console.log('[Reminder] Image search query:', query);
				const searxUrl = settingsStore.getSearxUrl();
				if (searxUrl && query) {
					try {
						imageSearchStore.setLoading(true);
						const searxParam = `&searxUrl=${encodeURIComponent(searxUrl)}`;
						const res = await fetch(`/api/search/images?q=${encodeURIComponent(query)}${searxParam}`);
						const data = await res.json();
						if (res.ok && data.results?.length > 0) {
							imageSearchStore.openModal(data.results, query);
							// Notify LLM so it can comment on the images
							const notifyMsg = `⏰ REMINDER TRIGGERED — Image search results for "${query}" are now displayed in the popup. Describe what you see enthusiastically!`;
							await sendReminderMessage(notifyMsg);
						} else {
							console.warn('[Reminder] Image search failed:', data.error);
						}
					} catch (e) {
						console.warn('[Reminder] Image search fetch error:', e);
					} finally {
						imageSearchStore.setLoading(false);
					}
				}
				return;
			}

			// Regular text reminder
			const msg = `⏰ REMINDER TRIGGERED: "${content}" — This is your reminder. React to it NOW by performing the described action or saying something enthusiastic and fitting.`;
			await sendReminderMessage(msg);
		});
		reminderStore.startPolling();
		return () => {
			reminderStore.stopPolling();
			reminderStore.setOnReminderFired(null);
		};
	});

	async function sendReminderMessage(msg: string) {
		debugStore.addLog({
			category: 'memory',
			title: 'Reminder triggered',
			content: msg
		});
		if (chatStore.isLoading) {
			const waitInterval = setInterval(() => {
				if (!chatStore.isLoading) {
					clearInterval(waitInterval);
					handleSend(msg, 'system');
				}
			}, 500);
			setTimeout(() => clearInterval(waitInterval), 60000);
		} else {
			handleSend(msg, 'system');
		}
	}

	// Process companion response with v2 system
	async function processCompanionResponse(userMessage: string, companionResponse: string): Promise<string> {
		const state = characterStore.state;

		const baselineUpdates = calculateBaselineUpdates(userMessage, state);

		const parsed = parseResponse(companionResponse);
		debugStore.addLog({
			category: 'memory',
			title: 'Raw LLM Response',
			content: companionResponse.slice(0, 2000) + (companionResponse.length > 2000 ? '\n... (truncated)' : '')
		});
		debugStore.addLog({
			category: 'memory',
			title: 'Memory Parse Result',
			content: `JSON detected: ${!!parsed.stateUpdates}\nnew_memory: ${parsed.stateUpdates?.newMemory ?? 'none'}\nstructured_fact: ${parsed.stateUpdates?.structuredFactSeen ? `${parsed.stateUpdates.structuredFactSeen.type}/${parsed.stateUpdates.structuredFactSeen.key}=${parsed.stateUpdates.structuredFactSeen.value}` : 'none'}\nmood_change: ${parsed.stateUpdates?.moodChange ? `${parsed.stateUpdates.moodChange.emotion} (${parsed.stateUpdates.moodChange.intensityDelta})` : 'none'}\nparseError: ${parsed.parseError ?? 'none'}`
		});
		const { queries: imageQueries, shouldClose: shouldCloseImages, cleanedText: imageCleaned } = extractImageSearchTags(parsed.dialogue);
		let dialogue = imageCleaned;
		const llmUpdates = parsed.stateUpdates;

		// Close image modal if LLM requested it
		if (shouldCloseImages) {
			imageSearchStore.closeModal();
		} else if (imageSearchStore.isOpen && isCloseImageRequest(userMessage)) {
			// Client fallback: user asked to close images but LLM forgot the tag
			imageSearchStore.closeModal();
		}

		// Reminder tag extraction from LLM response
		const { reminders: llmReminders, cleanedText: reminderCleaned } = extractReminderTags(dialogue);
		dialogue = reminderCleaned;
		const currentSessionId = getWorkingMemory().currentSessionId;
		if (currentSessionId && llmReminders.length > 0) {
			for (const r of llmReminders) {
				try {
					await reminderStore.addReminder(r.content, r.triggerAt, currentSessionId);
					console.log('[Reminder] Saved from LLM:', r.content, 'for', r.triggerAt.toLocaleTimeString());
				} catch (e) {
					console.error('[Reminder] Failed to save LLM reminder:', e);
				}
			}
		}

		// Vocabulary tag extraction
		const { tags: vocabTags, cleanedText: vocabCleaned } = extractVocabTags(dialogue);
		dialogue = vocabCleaned;

		if (vocabTags.length > 0 && settingsStore.isVocabularyEnabled()) {
			for (const tag of vocabTags) {
				try {
					const entries = await vocabularyStorage.getVocabularyEntries({
						mode: tag.mode,
						filter: tag.filter,
						count: tag.count,
						characterId: currentCharacterId
					});
					if (entries.length > 0) {
						chatStore.addSystemMessage(
							'Vocabulary for practice:\n' +
								entries.map((e) => `${e.sourceWord} = ${e.targetWord}`).join('\n')
						);
					}
				} catch (e) {
					console.warn('[Vocabulary] Failed to load entries:', e);
				}
			}
		}

		// Image search extraction
		if (imageQueries.length > 0) {
			const searxUrl = settingsStore.getSearxUrl();
			if (searxUrl) {
				for (const query of imageQueries) {
					try {
						imageSearchStore.setLoading(true);
						const searxParam = searxUrl ? `&searxUrl=${encodeURIComponent(searxUrl)}` : '';
						const res = await fetch(`/api/search/images?q=${encodeURIComponent(query)}${searxParam}`);
						const data = await res.json();
						if (res.ok && data.results?.length > 0) {
							imageSearchStore.openModal(data.results, query);
						} else if (data.error) {
							console.warn('[ImageSearch] Search failed:', data.error);
						}
					} catch (e) {
						console.warn('[ImageSearch] Fetch error:', e);
					} finally {
						imageSearchStore.setLoading(false);
					}
				}
			}
		}

		let validatedLLMUpdates = null;
		if (llmUpdates) {
			const validation = validateStateUpdates(llmUpdates);
			validatedLLMUpdates = validation.sanitized;
		}

		const finalUpdates = mergeUpdates(baselineUpdates, validatedLLMUpdates || {});
		characterStore.applyUpdates(finalUpdates);

		// Save LLM memory observation
		if (finalUpdates.newMemory) {
			try {
				const isUserFact = finalUpdates.newMemory.toLowerCase().startsWith('user');
				const created = await memoryApi.createFact({
					content: finalUpdates.newMemory,
					category: determineFactCategory(finalUpdates.newMemory),
					importance: calculateFactImportance(finalUpdates.newMemory),
					characterId: isUserFact ? SHARED_CHARACTER_ID : currentCharacterId
				});
				debugStore.addLog({
					category: 'memory',
					title: 'Memory Saved (new_memory)',
					content: `Character: ${isUserFact ? SHARED_CHARACTER_ID : currentCharacterId}\nContent: ${created.content}`
				});
			} catch (e) {
				console.debug('[Memory] Failed to save LLM observation:', e);
			}
		}

		// Save structured fact to fact library
		if (finalUpdates.structuredFactSeen) {
			try {
				const fact = finalUpdates.structuredFactSeen;
				const existing = await memoryStorage.getFactLibraryEntryByKey(
					fact.key,
					fact.type,
					currentCharacterId
				);
				if (existing && existing.id !== undefined) {
					// Update existing entry
					await memoryStorage.updateFactLibraryEntry(existing.id, {
						value: fact.value,
						category: fact.category,
						tags: fact.tags,
						lastReviewedAt: new Date()
					});
					await memoryStorage.incrementFactLibraryReview(existing.id, 0.15);
					debugStore.logFact('Updated', fact.key, fact.type);
				} else {
					// Create new entry
					await memoryStorage.saveFactLibraryEntry({
						characterId: currentCharacterId,
						type: fact.type,
						key: fact.key,
						value: fact.value,
						category: fact.category,
						tags: fact.tags,
						confidence: 0.3
					});
					debugStore.logFact('Created', fact.key, fact.type);
				}
			} catch (e) {
				console.debug('[FactLibrary] Failed to save structured fact:', e);
			}
		}

		// Check stage transitions (only in Dating Sim Mode)
		if (characterStore.appMode === 'dating_sim') {
			const completedEventIds = characterStore.state.completedEvents || [];
			const transition = checkAndApplyStageTransition(characterStore.state, completedEventIds);
			if (transition.transitioned && transition.toStage) {
				characterStore.setRelationshipStage(transition.toStage);
			}
		}

		// Save to working memory and IndexedDB
		const sessionId = workingMemory.currentSessionId;
		addTurnToWorkingMemory({ role: 'user', content: userMessage, sessionId, createdAt: new Date() });
		addTurnToWorkingMemory({ role: 'assistant', content: dialogue, sessionId, createdAt: new Date() });

		// Also persist turns to IndexedDB
		if (sessionId) {
			try {
				await memoryStorage.saveConversationTurn({
					characterId: currentCharacterId,
					role: 'user',
					content: userMessage,
					sessionId,
					createdAt: new Date()
				});
				await memoryStorage.saveConversationTurn({
					characterId: currentCharacterId,
					role: 'assistant',
					content: dialogue,
					sessionId,
					createdAt: new Date()
				});
			} catch (e) {
				console.debug('[Session] Failed to save turns:', e);
			}
		}

		// Extract facts
		const potentialFacts = extractPotentialFacts(dialogue, userMessage);
		debugStore.addLog({
			category: 'memory',
			title: 'Heuristic Facts Extracted',
			content: `Found ${potentialFacts.length}\n${potentialFacts.slice(0, 5).join('\n')}`
		});
		for (const factContent of potentialFacts.slice(0, 2)) {
			try {
				const userAnalysis = analyzeMessage(userMessage);
				const isUserFact = factContent.toLowerCase().startsWith('user');
				const created = await memoryApi.createFact({
					content: factContent,
					category: determineFactCategory(factContent),
					importance: calculateFactImportance(factContent, userAnalysis.sentiment),
					characterId: isUserFact ? SHARED_CHARACTER_ID : currentCharacterId
				});
				debugStore.addLog({
					category: 'memory',
					title: 'Memory Saved (heuristic)',
					content: `Character: ${isUserFact ? SHARED_CHARACTER_ID : currentCharacterId}\nContent: ${created.content}`
				});
			} catch (e) {
				console.debug('Failed to save fact:', e);
			}
		}

		// Check for events (only in Dating Sim Mode)
		if (characterStore.appMode === 'dating_sim') {
			try {
				const completedEvents = await eventsApi.getCompletedEvents();
				const wm = getWorkingMemory();
				const isEarlyInSession = (wm.messageCount ?? 0) <= 3;
				const contextFreeTypes: EventType[] = ['milestone', 'anniversary'];
				const triggeredEvents = checkAllEvents(allEvents, characterStore.state, completedEvents, userMessage)
					.filter(event => contextFreeTypes.includes(event.type) || isEarlyInSession);
				if (triggeredEvents.length > 0) {
					activeEvent = triggeredEvents[0];
				}
			} catch (e) {
				console.debug('Event check failed:', e);
			}
		}

		return dialogue;
	}

	// Trigger personality evolution analysis after threshold reached
	async function triggerEvolutionAnalysis() {
		try {
			const sessions = await memoryStorage.getSessions({
				characterId: currentCharacterId,
				ended: true,
				limit: characterStore.state.evolutionThreshold
			});
			const { analyzeEvolution } = await import('$lib/engine/memory');

			// Sprache aus TTS-Config ableiten
			const speechSettings = modulesStore.getModuleSettings('speech');
			const activeTTSProvider = speechSettings?.activeProvider as string | undefined;
			const ttsConfig = activeTTSProvider
				? settingsStore.getProviderConfig(activeTTSProvider)
				: null;
			const language = ttsConfig?.language || undefined;

			const suggestions = await analyzeEvolution(
				sessions,
				characterStore.state.personality,
				characterStore.state.name,
				language
			);
			if (suggestions.length > 0) {
				pendingEvolutionSuggestions = suggestions;
				evolutionLanguage = language;
				debugStore.logSession('Evolution pending', `${suggestions.length} suggestion(s) awaiting user confirmation`);
			}
		} catch (e) {
			console.error('[Evolution] Analysis failed:', e);
		}
	}

	function handleEvolutionConfirm(adaptations: string[]) {
		characterStore.applyEvolution(adaptations);
		pendingEvolutionSuggestions = null;
		evolutionLanguage = undefined;
		debugStore.logSession('Evolution applied', adaptations.join(', '));
	}

	function handleEvolutionReject() {
		pendingEvolutionSuggestions = null;
		evolutionLanguage = undefined;
		debugStore.logSession('Evolution rejected', 'User declined adaptations');
	}

	// Build system prompt
	async function buildCompanionSystemPrompt(
		userMessage: string,
		options?: { continueMode?: boolean; continueFromText?: string }
	): Promise<string> {
		const state = characterStore.state;
		const persona = personaStore.activeCard;
		const memories = await retrieveRelevantContext(userMessage, currentCharacterId);

		const speechSettings = modulesStore.getModuleSettings('speech');
		const activeTTSProvider = speechSettings?.activeProvider as string | undefined;
		const ttsConfig = activeTTSProvider ? settingsStore.getProviderConfig(activeTTSProvider) : null;
		const activeMcpTools = mcpStore.hasActiveTools && !isTauri() ? mcpStore.tools : undefined;

		// Build emotion mappings for the current VRM model
		const emotionProfile = vrmStore.emotionProfile;
		const emotionMappings = emotionProfile
			? Object.fromEntries(
					Object.entries(emotionProfile)
						.filter(([, m]) => m.expression)
						.map(([tag, m]) => [tag, m.expression])
				)
			: undefined;

		const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
		const contextSize = Number(consciousnessSettings.contextSize) || 32768;
		const memoryBudget = getMemoryBudget(contextSize);

		const context: PromptContext = {
			persona,
			state,
			memories,
			userMessage,
			systemTime: new Date(),
			ttsProvider: activeTTSProvider,
			ttsLanguage: ttsConfig?.language || undefined,
			ttsAltVoiceEnabled: activeTTSProvider === 'omnivoice' && !!(ttsConfig?.omnivoiceAltEnabled),
			mcpTools: activeMcpTools,
			continueMode: options?.continueMode,
			continueFromText: options?.continueFromText,
			availableExpressions: vrmStore.availableExpressions,
			availableActions: vrmStore.llmActions,
			emotionMappings,
			searxUrl: settingsStore.getSearxUrl() || undefined,
			imageModalOpen: imageSearchStore.isOpen,
			imageModalQuery: imageSearchStore.isOpen ? imageSearchStore.currentQuery : undefined,
			vocabularyEnabled: settingsStore.isVocabularyEnabled(),
			factLibraryEnabled: true,
			memoryBudget,
			sessionStartedAt: getWorkingMemory().sessionStartedAt
		};

		const systemPrompt = buildSystemPrompt(context);

		// Debug logging
		debugStore.logMemory({
			recentTurns: memories.recentTurns.length,
			relevantFacts: memories.relevantFacts.length,
			triggeredMemories: memories.triggeredMemories.length,
			recentSessions: memories.recentSessions.length,
			factLibraryEntries: memories.factLibraryEntries.length
		});
		debugStore.logPrompt(systemPrompt, userMessage);

		return systemPrompt;
	}

	// Handle send message
	async function handleSend(content: string, role: 'user' | 'system' = 'user') {
		if (!content.trim()) return;

		const myGeneration = ++sendGeneration;

		// If LLM is currently generating, interrupt it first (like duplex does)
		if (chatStore.isLoading) {
			ttsStore.stop();
			llmAbortController?.abort();
			chatStore.setLoading(false);
		}

		if (!modulesStore.isModuleEnabled('consciousness')) {
			chatStore.setError('Chat is disabled. Enable it in Settings > Character > AI Services.');
			return;
		}

		// Session management: check if new session should start
		const state = characterStore.state;
		if (shouldStartNewSession(state.lastInteraction)) {
			try {
				const session = await startNewSession(currentCharacterId, characterStore.state.name);
				debugStore.logSession('Session started', `Session ID: ${session.id}`);
				// Increment session count and check for evolution
				characterStore.incrementSessionCount();
				if (characterStore.isEvolutionDue()) {
					// Trigger evolution analysis (async, non-blocking)
					triggerEvolutionAnalysis();
				}
			} catch (e) {
				console.error('[Session] Failed to start new session:', e);
			}
		}

		if (role === 'user') {
			// Client-side fallback: parse natural-language reminder requests directly
			const wm = getWorkingMemory();
			const directReminder = tryExtractReminderFromUserMessage(content);
			if (directReminder && wm.currentSessionId) {
				try {
					await reminderStore.addReminder(directReminder.content, directReminder.triggerAt, wm.currentSessionId);
					console.log('[Reminder] Direct fallback saved:', directReminder.content, 'for', directReminder.triggerAt.toLocaleTimeString());
				} catch (e) {
					console.error('[Reminder] Direct fallback failed:', e);
				}
			}

			// Client-side fallback: "Zeige mir in 2 Minuten Bilder von Rosen"
			// → creates a delayed image-search reminder instead of immediate search
			const delayedImage = tryExtractDelayedImageSearch(content);
			if (delayedImage && wm.currentSessionId) {
				try {
					await reminderStore.addReminder(
						`search_image:${delayedImage.query}`,
						delayedImage.triggerAt,
						wm.currentSessionId
					);
					console.log('[Reminder] Delayed image search saved:', delayedImage.query, 'for', delayedImage.triggerAt.toLocaleTimeString());
				} catch (e) {
					console.error('[Reminder] Failed to save delayed image search:', e);
				}
			}
		}

		// NOTE: Immediate image search fallback removed.
		// The LLM must decide what to search for via [search_image:query] tags.
		// This prevents showing irrelevant images before the LLM responds.

		const continueMode = isContinueRequest(content);

		// If TTS was interrupted and there are unplayed segments, replay them directly
		// without calling the LLM — "setze fort" resumes exactly where audio stopped.
		if (continueMode && lastPlayedSegmentIndex < sessionSegments.length - 1) {
			const unplayed = sessionSegments.slice(lastPlayedSegmentIndex + 1);
			if (unplayed.length > 0) {
				const speechState = modulesStore.getModuleState('speech');
				const speechSettings = modulesStore.getModuleSettings('speech');
				const ttsEnabled = speechState?.enabled;
				const ttsProvider = speechSettings?.activeProvider as TTSProvider | undefined;
				const ttsConfig = ttsProvider ? settingsStore.getProviderConfig(ttsProvider) : null;
				const isChatterbox = ttsProvider === 'chatterbox';
				const isOmniVoice = ttsProvider === 'omnivoice';
				const ttsMeta = ttsProvider ? getTTSProvider(ttsProvider) : null;
				const ttsOptions = ttsEnabled && ttsProvider && ttsConfig ? {
					provider: ttsProvider,
					apiKey: ttsConfig.apiKey,
					voiceId: isOmniVoice
						? (buildOmniVoiceDescriptor(ttsConfig) || (speechSettings.activeVoiceId as string) || ttsConfig.voiceId)
						: ((speechSettings.activeVoiceId as string) || ttsConfig.voiceId),
					alternativeVoiceId: isOmniVoice
						? (ttsConfig.omnivoiceAltEnabled ? buildOmniVoiceDescriptor(ttsConfig, true) : undefined)
						: undefined,
					rvcVoiceId: (speechSettings.activeRvcVoiceId as string) || ttsConfig.rvcVoiceId,
					baseUrl: ttsConfig.baseUrl || ttsMeta?.defaultBaseUrl,
					speed: isOmniVoice
						? (ttsConfig.omnivoiceDefaultSpeed ?? (speechSettings.speed as number) ?? 1)
						: ((speechSettings.speed as number) ?? 1),
					alternativeSpeed: isOmniVoice ? ttsConfig.omnivoiceAltSpeed : undefined,
					exaggeration: ttsConfig.exaggeration,
					language: ttsConfig.language,
					cfgWeight: ttsConfig.cfgWeight,
					temperature: ttsConfig.temperature,
					omnivoiceNumStep: ttsConfig.omnivoiceNumStep
				} : null;

				if (ttsOptions) {
					chatStore.addMessage('user', content);
					sessionSegments = unplayed;
					lastPlayedSegmentIndex = -1;
					spokenSoFar = '';
					latestResponse = '';
					onTTSStarted();
					vrmStore.startTalking(unplayed[0].text);
					ttsStore.beginSpeechSession(ttsOptions, {
						onSentenceStart: (sentence, index) => {
							lastPlayedSegmentIndex = index;
							isTyping = false;
							latestResponse = sentence;
							spokenSoFar = spokenSoFar ? spokenSoFar + ' ' + sentence : sentence;
							duplexStore.setTtsText(sentence);
						}
					});
					for (const seg of unplayed) ttsStore.pushSpeechSegment(seg);
					await ttsStore.endSpeechSession();
					onTTSDone();
					return;
				}
			}
		}

		let continueFromText: string | undefined;
		if (continueMode) {
			for (let i = chatStore.messages.length - 1; i >= 0; i--) {
				const msg = chatStore.messages[i];
				if (msg.role === 'assistant' && msg.content) {
					continueFromText = msg.content;
					break;
				}
			}
		}

		chatStore.addMessage(role, content);
		chatStore.setLoading(true);
		chatStore.setError(null);
		isTyping = true;
		latestResponse = '';
		spokenSoFar = '';

		characterStore.updateStreak();
		characterStore.updateDaysKnown();

		llmAbortController = new AbortController();

		try {
			const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
			const provider = consciousnessSettings.activeProvider as string;
			const model = consciousnessSettings.activeModel as string;

			if (!provider) {
				throw new Error('Please configure a provider in Settings > Modules > Consciousness');
			}

			const systemPrompt = await buildCompanionSystemPrompt(content, { continueMode, continueFromText });
			const providerConfig = settingsStore.getProviderConfig(provider);
			const apiKey = providerConfig.apiKey;
			const providerMeta = getLLMProvider(provider);

			if (providerMeta?.requiresApiKey && !apiKey) {
				throw new Error(`Please configure API key for ${providerMeta.name} in Settings > Providers`);
			}

			chatStore.addMessage('assistant', '');
			let fullContent = '';
			const selectedModel = model || providerMeta?.models?.[0]?.id || '';

			const speechState = modulesStore.getModuleState('speech');
			const speechSettings = modulesStore.getModuleSettings('speech');
			const ttsEnabled = speechState?.enabled;
			const ttsProvider = speechSettings?.activeProvider as TTSProvider | undefined;
			const ttsConfig = ttsProvider ? settingsStore.getProviderConfig(ttsProvider) : null;
			const isChatterbox = ttsProvider === 'chatterbox';
			const isOmniVoice = ttsProvider === 'omnivoice';
			const ttsMeta = ttsProvider ? getTTSProvider(ttsProvider) : null;
			const ttsOptions =
				ttsEnabled && ttsProvider && ttsConfig
					? {
							provider: ttsProvider,
							apiKey: ttsConfig.apiKey,
							voiceId: isOmniVoice
								? (buildOmniVoiceDescriptor(ttsConfig) || (speechSettings.activeVoiceId as string) || ttsConfig.voiceId)
								: ((speechSettings.activeVoiceId as string) || ttsConfig.voiceId),
							alternativeVoiceId: isOmniVoice
								? (ttsConfig.omnivoiceAltEnabled ? buildOmniVoiceDescriptor(ttsConfig, true) : undefined)
								: ((ttsConfig.alternativeVoiceId as string) || undefined),
							rvcVoiceId: (speechSettings.activeRvcVoiceId as string) || ttsConfig.rvcVoiceId,
							baseUrl: ttsConfig.baseUrl || ttsMeta?.defaultBaseUrl,
							speed: isOmniVoice
								? (ttsConfig.omnivoiceDefaultSpeed ?? (speechSettings.speed as number) ?? 1)
								: ((speechSettings.speed as number) ?? 1),
							alternativeSpeed: isOmniVoice ? ttsConfig.omnivoiceAltSpeed : undefined,
							exaggeration: ttsConfig.exaggeration,
							language: ttsConfig.language,
							cfgWeight: ttsConfig.cfgWeight,
							temperature: ttsConfig.temperature,
							omnivoiceNumStep: ttsConfig.omnivoiceNumStep
						}
					: null;

			let ttsStarted = false;
			// Reset replay tracking for this response
			sessionSegments = [];
			lastPlayedSegmentIndex = -1;

			const enqueueTTS = (segment: SpeechSegment) => {
				if (!ttsOptions) return;
				sessionSegments.push(segment);
				if (!ttsStarted) {
					ttsStarted = true;
					vrmStore.startTalking(segment.text);
					onTTSStarted();
					// Open a pipeline session — synthesis of each segment starts immediately
					// when pushSpeechSegment() is called, overlapping with playback.
					ttsStore.beginSpeechSession(ttsOptions, {
						onSentenceStart: (sentence, index) => {
							lastPlayedSegmentIndex = index;
							isTyping = false;
							latestResponse = sentence;
							spokenSoFar = spokenSoFar ? spokenSoFar + ' ' + sentence : sentence;
							duplexStore.setTtsText(sentence);
						}
					});
				}
				ttsStore.pushSpeechSegment(segment);
			};
			const speechBuffer = ttsOptions
				? new StreamingSpeechBuffer({
						defaultLanguage: ttsConfig?.language || undefined,
						streaming: isChatterbox,
						onSegment: (segment) => {
							enqueueTTS(segment);
						}
					})
				: null;

			const shouldUseDirectChat = isTauri();

			if (shouldUseDirectChat) {
				await new Promise<void>((resolve, reject) => {
					streamChatDirect(
						{
							messages: chatStore.messages.slice(0, -1).map((m) => ({
								role: m.role as 'user' | 'assistant',
								content: m.apiContent ?? m.content
							})),
							provider: provider as import('$lib/types').LLMProvider,
							model: selectedModel,
							apiKey: apiKey || undefined,
							baseURL: providerConfig.baseUrl || providerMeta?.defaultBaseUrl,
							systemPrompt
						},
						(text) => {
							fullContent += text;
							chatStore.updateLastMessage(stripAllTags(fullContent), stripForApiContext(fullContent));
							const { cleaned, removed } = stripForSpeech(text);
							if (removed.length > 0) {
								console.debug('[TTS] Filtered artifacts:', removed);
								debugStore.logSpeechArtifact(removed);
							}
							speechBuffer?.feed(cleaned);
						},
						(error) => reject(new Error(error)),
						() => resolve()
					);
				});
			} else {
				const mcpEnabled = mcpStore.hasActiveTools && !isTauri();
				const chatEndpoint = mcpEnabled ? '/api/mcp/chat' : '/api/chat';
				const chatBody: Record<string, unknown> = {
					messages: chatStore.messages.map((m) => ({ role: m.role, content: m.apiContent ?? m.content })),
					provider,
					model: selectedModel,
					apiKey: apiKey || undefined,
					baseURL: providerConfig.baseUrl || providerMeta?.defaultBaseUrl,
					systemPrompt,
					continueMode: continueMode || undefined,
					continueFromText: continueFromText || undefined
				};
				if (mcpEnabled) {
					chatBody.tools = mcpStore.tools;
					chatBody.servers = mcpStore.enabledServers;
				}

				const response = await fetch(chatEndpoint, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(chatBody),
					signal: llmAbortController.signal
				});

				if (!response.ok) {
					let errorMsg = 'Failed to get response';
					try {
						const body = await response.json();
						if (body.error) errorMsg = body.error;
					} catch {
						// Ignore non-JSON errors.
					}
					throw new Error(errorMsg);
				}

				const reader = response.body?.getReader();
				const decoder = new TextDecoder();
				if (!reader) throw new Error('No response body');

				while (true) {
					if (llmAbortController.signal.aborted) break;

					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					for (const line of chunk.split('\n')) {
						if (line.startsWith('0:')) {
							const text = JSON.parse(line.slice(2));
							fullContent += text;
							chatStore.updateLastMessage(stripAllTags(fullContent), stripForApiContext(fullContent));
							const { cleaned, removed } = stripForSpeech(text);
							if (removed.length > 0) {
								console.debug('[TTS] Filtered artifacts:', removed);
								debugStore.logSpeechArtifact(removed);
							}
							speechBuffer?.feed(cleaned);
						} else if (line.startsWith('e:')) {
							const { error } = JSON.parse(line.slice(2));
							throw new Error(error);
						}
					}
				}
			}

			speechBuffer?.flush();
			isTyping = false;
			const cleanedResponse = await processCompanionResponse(content, fullContent);
			const displayText = stripAllTags(cleanedResponse);
			chatStore.updateLastMessage(displayText, stripForApiContext(cleanedResponse));

			if (ttsEnabled && !ttsStarted && cleanedResponse) {
				// LLM response was too short to trigger speech buffer during streaming —
				// start a fresh pipeline session for the complete text now.
				vrmStore.startTalking(displayText);
				onTTSStarted();
				const segments = splitIntoSegments(cleanedResponse, ttsConfig?.language || undefined, isChatterbox);
				ttsStore.beginSpeechSession(ttsOptions!, {
					onSentenceStart: (sentence) => {
						isTyping = false;
						latestResponse = sentence;
						spokenSoFar = spokenSoFar ? spokenSoFar + ' ' + sentence : sentence;
						duplexStore.setTtsText(sentence);
					}
				});
				for (const seg of segments) {
					ttsStore.pushSpeechSegment(seg);
				}
				await ttsStore.endSpeechSession();
				onTTSDone();
			} else if (ttsEnabled && ttsStarted) {
				// Pipeline session already open — close it and wait for remaining audio.
				await ttsStore.endSpeechSession();
				spokenSoFar = '';
				latestResponse = '';
				onTTSDone();
			} else {
				latestResponse = displayText;
				if (displayText) {
					vrmStore.startTalking(displayText);
				}
				// Even without TTS, parse segments to trigger implicit actions & emotions
				const textSegments = splitIntoSegments(cleanedResponse, undefined, false);
				const firstAction = textSegments.find((s) => s.action)?.action;
				const firstEmotion = textSegments.find((s) => s.emotion)?.emotion;
				if (firstAction) vrmStore.triggerAction(firstAction);
				if (firstEmotion) {
					vrmStore.setEmotion(firstEmotion);
					expressionController.setEmotion(firstEmotion);
				}
				onTTSDone();
			}
		} catch (err) {
			// Ignore abort errors from this generation; a newer send may already be running.
			if (myGeneration !== sendGeneration) return;
			const message = err instanceof Error ? err.message : 'Unknown error';
			if (message !== 'The operation was aborted.' && !message.includes('aborted')) {
				chatStore.setError(message);
			}
			isTyping = false;
		} finally {
			// Only clear state if no newer send has started.
			if (myGeneration === sendGeneration) {
				chatStore.setLoading(false);
				llmAbortController = null;
			}
		}
	}

	async function toggleDuplex() {
		if (duplexStore.isDuplexActive) {
			stopDuplex();
		} else {
			await startDuplex({
				onTranscript: handleSend,
				onInterrupt: () => {
					ttsStore.stop();
					llmAbortController?.abort();
					chatStore.setLoading(false);
				},
				isProcessing: () => chatStore.isLoading
			});
		}
	}

	// Handle speech bubble hide
	function handleBubbleHide() {
		latestResponse = '';
	}

	// Handle event completion
	function handleEventComplete(choiceIndex?: number, stateChanges?: Partial<StateUpdates>) {
		if (!activeEvent) return;

		const event = $state.snapshot(activeEvent);

		if (stateChanges) {
			characterStore.applyUpdates(stateChanges as StateUpdates);
		} else if (event.stateChanges) {
			characterStore.applyUpdates(event.stateChanges);
		}

		eventsApi.recordCompletedEvent(
			event,
			choiceIndex,
			choiceIndex !== undefined ? `Choice ${choiceIndex + 1}` : undefined
		).then(() => {
			characterStore.markEventCompleted(event.id);
		}).catch((e) => {
			console.error('Failed to record event completion:', e);
		});

		activeEvent = null;
	}

	function handleEventClose() {
		activeEvent = null;
	}

	async function deleteReminder(id: number) {
		await reminderStore.deleteReminder(id);
	}
</script>

<div class="app-container" style:--debug-panel-height={debugStore.panelVisible ? '30vh' : '0px'}>
	<TopLeftButtons onOpenMemoryGraph={() => showMemoryGraph = true} onOpenFactLibrary={() => showFactLibrary = true} onOpenVocabulary={() => showVocabulary = true} onOpenMemoryInspector={() => showMemoryInspector = true} {leftOffset} />
	<TopRightButtons
		onInfoClick={() => showInfoModal = true}
		{showSidebarBtn}
		sidebarOpen={sidebarOpen}
		onToggleSidebar={() => sidebarOpen = !sidebarOpen}
		{rightOffset}
		upcomingReminders={reminderStore.upcoming}
		onDeleteReminder={deleteReminder}
	/>
	{#if showInfoModal}
		<InfoModal onClose={() => showInfoModal = false} />
	{/if}
	{#if showMemoryGraph}
		<MemoryGraphModal onClose={() => showMemoryGraph = false} />
	{/if}
	{#if showFactLibrary}
		<FactLibraryModal onClose={() => showFactLibrary = false} />
	{/if}
	{#if showVocabulary}
		<VocabularyModal onClose={() => showVocabulary = false} />
	{/if}
	{#if showMemoryInspector}
		<MemoryInspectorModal onClose={() => showMemoryInspector = false} />
	{/if}
	{#if pendingEvolutionSuggestions}
		<EvolutionConfirmModal
			suggestions={pendingEvolutionSuggestions}
			companionName={characterStore.state.name}
			onConfirm={handleEvolutionConfirm}
			onReject={handleEvolutionReject}
			language={evolutionLanguage}
		/>
	{/if}

	<main class="main-content">
		<!-- VRM Stage (Full Background) -->
		<div class="stage-container">
			{#if vrmStore.isLoading || !vrmStore.modelUrl}
				<div class="loading-dots">
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
				</div>
			{/if}

			{#if vrmStore.error}
				<div class="error-toast" onclick={() => vrmStore.setError(null)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vrmStore.setError(null); } }}>
					<span>{vrmStore.error}</span>
					<button type="button" class="toast-dismiss" aria-label="Dismiss">✕</button>
				</div>
			{/if}

			<VrmScene />
		</div>

		<!-- Companion Status (Top Left) - includes settings icons now -->
		<CompanionStatus />

		<!-- Floating Stat Indicators -->
		<FloatingStatIndicators />

		<!-- Speech Bubble (shows latest response, click to dismiss) -->
		{#if showBubble || (typingDotsVisible && isTyping)}
			<SpeechBubble
				message={displayStore.chatDisplayMode === 'off' ? '' : latestResponse}
				isTyping={isTyping && typingDotsVisible}
				onHide={handleBubbleHide}
			/>
		{/if}

		<!-- Chat History Sidebar -->
		<ChatSidebar
			open={sidebarOpen && showSidebarBtn}
			onClose={() => sidebarOpen = false}
			speakingText={spokenSoFar}
			{isTyping}
		/>

		<!-- Bottom Chat Bar -->
		<BottomChatBar
			onSend={handleSend}
			disabled={false}
			isDuplexActive={duplexStore.isDuplexActive}
			duplexPhase={duplexStore.duplexPhase}
			duplexAudioLevel={duplexStore.duplexAudioLevel}
			duplexNoiseDetected={duplexStore.noiseDetected}
			duplexSensitivity={duplexStore.sensitivity}
			onToggleDuplex={toggleDuplex}
			onAdjustSensitivity={(delta) => duplexStore.adjustSensitivity(delta)}
		/>

		<!-- Error toast for chat errors -->
		{#if chatStore.error}
			<div class="chat-error-toast" onclick={() => chatStore.setError(null)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chatStore.setError(null); } }}>
				<span>{chatStore.error}</span>
				<button type="button" class="toast-dismiss" aria-label="Dismiss">✕</button>
			</div>
		{/if}

		<!-- Event Scene Overlay -->
		{#if activeEvent?.scene}
			<EventScene
				scene={activeEvent.scene}
				eventName={activeEvent.name}
				eventType={activeEvent.type}
				companionName={personaStore.activeCard.name}
				language={uiLanguage}
				onComplete={handleEventComplete}
				onClose={handleEventClose}
			/>
		{/if}
	</main>

	<!-- Debug Panel (docked below main content when visible) -->
	<DebugPanel />

	<!-- Onboarding Modal (first-run) -->
	{#if showOnboarding}
		<OnboardingModal onComplete={() => {
			onboardingDismissed = true;
			showOnboarding = false;
		}} />
	{/if}

	<!-- Image Search Modal -->
	<ImageSearchModal {leftOffset} {rightOffset} />
</div>

<style>
	.app-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	.main-content {
		flex: 1;
		display: flex;
		position: relative;
		overflow: hidden;
	}

	.stage-container {
		position: absolute;
		inset: 0;
		z-index: 0;
	}

	.loading-dots {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		z-index: 20;
	}

	.loading-dots .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-tertiary);
		animation: bounce 1.4s ease-in-out infinite;
	}

	.loading-dots .dot:nth-child(2) {
		animation-delay: 0.16s;
	}

	.loading-dots .dot:nth-child(3) {
		animation-delay: 0.32s;
	}

	@keyframes bounce {
		0%, 80%, 100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}

	.error-toast,
	.chat-error-toast {
		position: fixed;
		top: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: fit-content;
		max-width: 600px;
		padding: 0.75rem 1rem;
		background: linear-gradient(180deg, #ff6b6b 0%, #ee5a5a 100%);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 16px;
		color: white;
		font-size: 0.875rem;
		cursor: pointer;
		z-index: 50;
		animation: errorSlideDownShake 0.5s ease-out;
		box-shadow:
			0 4px 20px rgba(238, 90, 90, 0.4),
			0 2px 4px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
	}

	.error-toast span,
	.chat-error-toast span {
		flex: 1;
		word-wrap: break-word;
	}

	.toast-dismiss {
		background: rgba(255, 255, 255, 0.2);
		border: none;
		padding: 0.25rem;
		border-radius: 6px;
		cursor: pointer;
		color: white;
		opacity: 0.9;
		font-size: 0.875rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
	}

	.toast-dismiss:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.3);
	}

	@keyframes errorSlideDownShake {
		0% {
			opacity: 0;
			transform: translateX(-50%) translateY(-8px);
		}
		30% {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
		45% {
			transform: translateX(calc(-50% + 6px)) translateY(0);
		}
		60% {
			transform: translateX(calc(-50% - 5px)) translateY(0);
		}
		75% {
			transform: translateX(calc(-50% + 3px)) translateY(0);
		}
		90% {
			transform: translateX(calc(-50% - 2px)) translateY(0);
		}
		100% {
			transform: translateX(-50%) translateY(0);
		}
	}

	.chat-error-toast {
		top: 5.5rem;
	}

	@media (max-width: 640px) {
		.error-toast,
		.chat-error-toast {
			width: fit-content;
			max-width: calc(100vw - 1.5rem);
		}
	}
</style>

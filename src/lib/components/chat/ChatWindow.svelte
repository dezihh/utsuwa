<script lang="ts">
	import MessageList from './MessageList.svelte';
	import ChatInput from './ChatInput.svelte';
	import { Icon } from '$lib/components/ui';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { ttsStore } from '$lib/stores/tts.svelte';
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import { personaStore } from '$lib/stores/persona.svelte';
	import { characterStore } from '$lib/stores/character.svelte';
	import { getLLMProvider, getTTSProvider } from '$lib/services/providers/registry';
	import { streamChatDirect } from '$lib/services/chat/client-chat';
	import { isTauri } from '$lib/services/platform';
	import type { TTSProvider } from '$lib/types';
	import type { EventDefinition } from '$lib/types/events';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { extractReminderTags } from '$lib/utils/reminders';
	import { db } from '$lib/db';
	import { getWorkingMemory, startNewSession, shouldStartNewSession } from '$lib/engine/memory';
	import Dropdown from '$lib/components/ui/Dropdown.svelte';

	// V2 companion system imports
	import { buildSystemPrompt, type PromptContext } from '$lib/ai/prompt-builder';
	import { parseResponse, validateStateUpdates, extractPotentialFacts } from '$lib/ai/response-parser';
	import { calculateBaselineUpdates, analyzeMessage } from '$lib/engine/heuristics';
	import { mergeUpdates, checkAndApplyStageTransition } from '$lib/engine/state-updates';
	import {
		retrieveRelevantContext,
		addTurnToWorkingMemory,
		hydrateWorkingMemory,
		memoryApi,
		determineFactCategory,
		calculateFactImportance
	} from '$lib/engine/memory';
	import { checkAllEvents, eventsApi } from '$lib/engine/events';
	import { allEvents } from '$lib/data/events';

	// Event props for scene triggering
	interface Props {
		onEventTriggered?: (event: EventDefinition) => void;
	}

	let { onEventTriggered }: Props = $props();

	// AbortController for cancelling in-flight direct-chat streams
	let chatAbortController: AbortController | null = null;

	// Track memory hydration state
	let isMemoryReady = $state(false);

	// Hydrate working memory from IndexedDB on mount
	$effect(() => {
		isMemoryReady = false;
		(async () => {
			await hydrateWorkingMemory();
			isMemoryReady = true;
		})();
	});

	// Start reminder polling and set up fired callback
	$effect(() => {
		reminderStore.setOnReminderFired((reminder) => {
			const msg = `[Reminder] It's time: ${reminder.content}`;
			if (chatStore.isLoading) {
				// Queue as system message so the LLM sees it in the next prompt
				chatStore.addSystemMessage(msg);
			} else {
				handleSend(msg);
			}
		});
		reminderStore.startPolling();
		return () => {
			reminderStore.stopPolling();
			reminderStore.setOnReminderFired(null);
		};
	});

	// Process companion response with v2 system
	async function processCompanionResponse(userMessage: string, companionResponse: string): Promise<string> {
		const state = characterStore.state;

		// 1. Calculate baseline updates from user message
		const baselineUpdates = calculateBaselineUpdates(userMessage, state);

		// 2. Parse companion response for LLM-suggested updates
		const parsed = parseResponse(companionResponse);
		const { reminders, cleanedText } = extractReminderTags(parsed.dialogue);
		const dialogue = cleanedText;
		const llmUpdates = parsed.stateUpdates;

		// 2b. Schedule any extracted reminders
		const sessionId = getWorkingMemory().currentSessionId;
		if (sessionId) {
			for (const r of reminders) {
				try {
					await reminderStore.addReminder(r.content, r.triggerAt, sessionId);
				} catch (e) {
					console.error('[Reminder] Failed to save reminder:', e);
				}
			}
		}
		if (parsed.parseError) {
			console.debug('LLM JSON parse error (using heuristics only):', parsed.parseError);
		}

		// 3. Validate and sanitize LLM updates if present
		let validatedLLMUpdates = null;
		if (llmUpdates) {
			const validation = validateStateUpdates(llmUpdates);
			if (validation.warnings.length > 0) {
				console.debug('LLM state update warnings:', validation.warnings);
			}
			validatedLLMUpdates = validation.sanitized;
		}

		// 4. Merge baseline + LLM updates (LLM takes precedence for mood)

		const finalUpdates = mergeUpdates(baselineUpdates, validatedLLMUpdates || {});
		// 5. Apply updates to character state
		characterStore.applyUpdates(finalUpdates);

		// 5b. Save LLM-generated memory observation if present
		if (finalUpdates.newMemory) {
			try {
				await memoryApi.createFact({
					content: finalUpdates.newMemory,
					category: determineFactCategory(finalUpdates.newMemory),
					importance: calculateFactImportance(finalUpdates.newMemory)
				});
			} catch (e) {
				console.debug('[Memory] Failed to save LLM observation:', e);
			}
		}

		// 6. Check for stage transitions (only in Dating Sim Mode)
		if (characterStore.appMode === 'dating_sim') {
			const completedEventIds = characterStore.state.completedEvents || [];
			const transition = checkAndApplyStageTransition(characterStore.state, completedEventIds);
			if (transition.transitioned && transition.toStage) {
				characterStore.setRelationshipStage(transition.toStage);
			}
		}

		// 7. Save conversation turns to working memory
		addTurnToWorkingMemory({ role: 'user', content: userMessage, createdAt: new Date() });
		addTurnToWorkingMemory({ role: 'assistant', content: dialogue, createdAt: new Date() });

		// 8. Extract and save potential facts
		const potentialFacts = extractPotentialFacts(dialogue, userMessage);
		for (const factContent of potentialFacts.slice(0, 2)) {
			try {
				const userAnalysis = analyzeMessage(userMessage);
				await memoryApi.createFact({
					content: factContent,
					category: determineFactCategory(factContent),
					importance: calculateFactImportance(factContent, userAnalysis.sentiment)
				});
			} catch (e) {
				console.debug('Failed to save fact:', e);
			}
		}

		// 9. Check for triggered events (only in Dating Sim Mode)
		if (characterStore.appMode === 'dating_sim') {
			try {
				const completedEvents = await eventsApi.getCompletedEvents();
				const triggeredEvents = checkAllEvents(
					allEvents,
					characterStore.state,
					completedEvents,
					userMessage
				);

				// Trigger the highest priority event
				if (triggeredEvents.length > 0 && onEventTriggered) {
					const topEvent = triggeredEvents[0];
					onEventTriggered(topEvent);
				}
			} catch (e) {
				console.debug('Event check failed:', e);
			}
		}

		// Return the cleaned dialogue
		return dialogue;
	}

	// Build the system prompt with v2 companion context
	async function buildCompanionSystemPrompt(userMessage: string): Promise<string> {
		const state = characterStore.state;
		const persona = personaStore.activeCard;
		const memories = await retrieveRelevantContext(userMessage);

		const speechSettings = modulesStore.getModuleSettings('speech');
		const activeTTSProvider = speechSettings?.activeProvider as string | undefined;
		const ttsConfig = activeTTSProvider ? settingsStore.getProviderConfig(activeTTSProvider) : null;

		// Build emotion mappings for the current VRM model
		const emotionProfile = vrmStore.emotionProfile;
		const emotionMappings = emotionProfile
			? Object.fromEntries(
					Object.entries(emotionProfile)
						.filter(([, m]) => m.expression)
						.map(([tag, m]) => [tag, m.expression])
				)
			: undefined;

		// Fetch pending reminders for this session
		const sessionId = getWorkingMemory().currentSessionId;
		let pendingReminders: Array<{ triggerAt: Date; content: string }> = [];
		if (sessionId) {
			try {
				pendingReminders = (await db.reminders
					.where('sessionId')
					.equals(sessionId)
					.and((r) => !r.executed)
					.toArray())
					.sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
					.map((r) => ({ triggerAt: r.triggerAt, content: r.content }));
			} catch {
				// ignore reminder fetch errors
			}
		}

		const context: PromptContext = {
			persona,
			state,
			memories,
			userMessage,
			systemTime: new Date(),
			ttsProvider: activeTTSProvider,
			ttsLanguage: ttsConfig?.language || undefined,
			availableExpressions: vrmStore.availableExpressions,
			availableActions: vrmStore.llmActions,
			emotionMappings,
			pendingReminders
		};

		return buildSystemPrompt(context);
	}

	async function handleSend(content: string) {
		if (!content.trim() || chatStore.isLoading) return;

		// Check if chat is enabled
		if (!modulesStore.isModuleEnabled('consciousness')) {
			chatStore.setError('Chat is disabled. Enable it in Settings > Character > AI Services.');
			return;
		}

		// Ensure a session exists before sending
		const wm = getWorkingMemory();
		if (!wm.currentSessionId) {
			try {
				await startNewSession('default', characterStore.state.name);
			} catch (e) {
				console.error('[Session] Failed to start new session:', e);
			}
		}

		// Add user message
		chatStore.addMessage('user', content);
		chatStore.setLoading(true);
		chatStore.setError(null);

		// Update streak on first message of the day
		characterStore.updateStreak();
		characterStore.updateDaysKnown();

		try {
			// Get LLM settings from consciousness module
			const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
			const provider = consciousnessSettings.activeProvider as string;
			const model = consciousnessSettings.activeModel as string;

			if (!provider) {
				throw new Error('Please configure a provider in Settings > Modules > Consciousness');
			}

			// Build system prompt with v2 companion context
			const systemPrompt = await buildCompanionSystemPrompt(content);

			// Get API key from settings store (single source of truth for credentials)
			const providerConfig = settingsStore.getProviderConfig(provider);
			const apiKey = providerConfig.apiKey;
			const providerMeta = getLLMProvider(provider);

			// Check if provider requires API key
			if (providerMeta?.requiresApiKey && !apiKey) {
				throw new Error(`Please configure API key for ${providerMeta.name} in Settings > Providers`);
			}

			chatStore.addMessage('assistant', '');
			let fullContent = '';
			const selectedModel = model || providerMeta?.models?.[0]?.id || '';

			if (isTauri()) {
				// Cancel any previous direct-chat stream before starting a new one
				chatAbortController?.abort();
				chatAbortController = new AbortController();
				await new Promise<void>((resolve, reject) => {
					streamChatDirect(
						{
							messages: chatStore.messages.slice(0, -1).filter((m) => m.content).map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
							provider: provider as import('$lib/types').LLMProvider,
							model: selectedModel,
							apiKey: apiKey || undefined,
							baseURL: providerConfig.baseUrl || providerMeta?.defaultBaseUrl,
							systemPrompt
						},
						(text) => { fullContent += text; chatStore.updateLastMessage(fullContent); },
						(error) => reject(new Error(error)),
						() => resolve(),
						chatAbortController!.signal
					);
				});
			} else {
				const response = await fetch('/api/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						messages: chatStore.messages
							.filter((m) => m.content)
							.map((m) => ({ role: m.role, content: m.content })),
						provider,
						model: selectedModel,
						apiKey: apiKey || 'not-needed',
						baseURL: providerConfig.baseUrl || providerMeta?.defaultBaseUrl,
						systemPrompt
					})
				});

				if (!response.ok) {
					let errorMsg = 'Failed to get response';
					try {
						const body = await response.json();
						if (body.error) errorMsg = body.error;
					} catch {
						// response wasn't JSON
					}
					throw new Error(errorMsg);
				}

				const reader = response.body?.getReader();
				const decoder = new TextDecoder();
				if (!reader) throw new Error('No response body');

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					for (const line of chunk.split('\n')) {
						if (line.startsWith('0:')) {
							const text = JSON.parse(line.slice(2));
							fullContent += text;
							chatStore.updateLastMessage(fullContent);
						} else if (line.startsWith('e:')) {
							const { error } = JSON.parse(line.slice(2));
							throw new Error(error);
						}
					}
				}
			}

			// Process response with v2 companion system
			const cleanedResponse = await processCompanionResponse(content, fullContent);

			// Update message with cleaned dialogue
			chatStore.updateLastMessage(cleanedResponse);

			// Free the input NOW — the LLM response is complete.
			// TTS and animations run independently; the user should be able
			// to type the next message while the avatar is still speaking.
			chatStore.setLoading(false);

			// Trigger talking animation based on response length
			if (cleanedResponse) {
				vrmStore.startTalking(cleanedResponse);
			}

			// Trigger TTS if speech module is enabled (use cleaned response)
			const speechState = modulesStore.getModuleState('speech');
			const speechSettings = modulesStore.getModuleSettings('speech');

			if (speechState?.enabled && cleanedResponse) {
				const ttsProvider = speechSettings.activeProvider as TTSProvider;
				const ttsConfig = settingsStore.getProviderConfig(ttsProvider);
				const ttsMeta = getTTSProvider(ttsProvider);

				ttsStore.speak(cleanedResponse, {
					provider: ttsProvider,
					apiKey: ttsConfig.apiKey,
					voiceId:
						(speechSettings.activeVoiceId as string) ||
						(speechSettings.activeModel as string) ||
						ttsConfig.voiceId,
					baseUrl: ttsConfig.baseUrl || ttsMeta?.defaultBaseUrl,
					speed: speechSettings.speed as number ?? 1
				});
			}
		} catch (err) {
			// Remove empty assistant placeholder if streaming failed
			const lastMsg = chatStore.messages[chatStore.messages.length - 1];
			if (lastMsg?.role === 'assistant' && !lastMsg.content) {
				chatStore.removeLastMessage();
			}
			if (err instanceof Error && err.name === 'AbortError') {
				// User cancelled the stream (e.g. sent a new message) — not an error
				console.log('Chat stream aborted');
			} else {
				chatStore.setError(err instanceof Error ? err.message : 'Unknown error');
				console.error('Chat error:', err);
			}
		} finally {
			chatStore.setLoading(false);
		}
	}

	function handleClear() {
		chatStore.clearMessages();
	}
</script>

<div class="chat-window">
	<header class="chat-header">
		<h2>{personaStore.activeCard.name}</h2>
		<div class="header-actions">
			{#if reminderStore.upcoming.length > 0}
				<Dropdown align="end" side="bottom" sideOffset={4}>
					{#snippet trigger()}
						<button class="btn btn-ghost icon-btn relative" title="Upcoming reminders">
							<Icon name="bell" size={16} />
							<span class="reminder-badge">{reminderStore.upcoming.length}</span>
						</button>
					{/snippet}
					<div class="reminder-dropdown">
						{#each reminderStore.upcoming as reminder (reminder.id)}
							<div class="reminder-item">
								<span class="reminder-content">{reminder.content}</span>
								<span class="reminder-time">{reminder.triggerAt.toLocaleTimeString()}</span>
							</div>
						{/each}
					</div>
				</Dropdown>
			{/if}
			{#if chatStore.messages.length > 0}
				<button class="btn btn-ghost icon-btn" onclick={handleClear} title="Clear messages">
					<Icon name="trash" size={16} />
				</button>
			{/if}
		</div>
	</header>

	<MessageList />

	{#if chatStore.error}
		<div class="error-message">
			{chatStore.error}
		</div>
	{/if}

	<ChatInput onSend={handleSend} disabled={chatStore.isLoading} />
</div>

<style>
	.chat-window {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-radius: 1rem;
		overflow: hidden;
	}

	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.chat-header h2 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-neutral-700);
	}

	.header-actions {
		display: flex;
		gap: 0.25rem;
	}

	.icon-btn {
		padding: 0.375rem;
	}

	.error-message {
		margin: 0 1rem;
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-error) 20%, transparent);
		border-radius: 0.5rem;
		color: var(--color-error);
		font-size: 0.75rem;
	}

	.reminder-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		background: var(--color-error);
		color: white;
		border-radius: 8px;
		font-size: 0.625rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.reminder-dropdown {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem;
		min-width: 12rem;
	}

	.reminder-item {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		background: var(--color-neutral-100);
	}

	:global(.dark) .reminder-item {
		background: var(--color-neutral-800);
	}

	.reminder-content {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.reminder-time {
		font-size: 0.6875rem;
		color: var(--color-neutral-400);
	}
</style>

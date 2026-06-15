<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import { memoryApi, getWorkingMemory, retroactivelyTagSession } from '$lib/engine/memory';
	import * as memoryStorage from '$lib/services/storage/memory';
	import { parseResponse, extractPotentialFacts } from '$lib/ai/response-parser';
	import { extractFactsFromLLM } from '$lib/services/memory/extract-facts';
	import { characterStore } from '$lib/stores/character.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import type { Fact, SessionSummary, ConversationTurn, FactLibraryEntry } from '$lib/types/memory';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	type Tab = 'session' | 'facts' | 'library' | 'sessions' | 'state' | 'test';
	let activeTab = $state<Tab>('session');
	let isLoading = $state(true);

	let facts = $state<Fact[]>([]);
	let libraryEntries = $state<FactLibraryEntry[]>([]);
	let sessions = $state<SessionSummary[]>([]);
	let turns = $state<ConversationTurn[]>([]);
	let isTagging = $state(false);
	let tagResult = $state<{ saved: number; skipped: number } | null>(null);

	// Parser test state
	let testUserMessage = $state('');
	let testLlmResponse = $state('');
	let testParseResult = $state<ReturnType<typeof parseResponse> | null>(null);
	let testExtractorFacts = $state<string[] | null>(null);
	let testPotentialFacts = $state<string[] | null>(null);
	let testSaveResult = $state<string | null>(null);
	let isTesting = $state(false);

	const currentCharacterId = $derived(settingsStore.getActiveProfileId());
	const characterState = $derived(characterStore.state);

	const TEMPLATES = {
		noCodeblock: {
			userMessage: 'Ich bin Softwareentwickler und arbeite an einem AI-Projekt.',
			llmResponse: 'Wie schön, dass du mir das erzählst!\n{"new_memory": "User arbeitet als Softwareentwickler an einem AI-Projekt", "mood_change": {"emotion": "happy", "intensity_delta": 10}}'
		},
		categoryList: {
			userMessage: 'Ich habe heute viel über mich erzählt.',
			llmResponse: 'Ich habe heute viel über dich gelernt:\nVorlieben: Ramen, Programmieren\nBeruf: Softwareentwickler\nZiel: Besseres Deutsch lernen'
		},
		correctCodeblock: {
			userMessage: 'Ich bin Softwareentwickler und mag Ramen.',
			llmResponse: 'Das klingt toll!\n```json\n{"new_memory": "User mag Ramen und ist Softwareentwickler"}\n```'
		}
	};

	async function loadAll() {
		isLoading = true;
		try {
			const [f, l, s] = await Promise.all([
				memoryApi.getFacts(100, currentCharacterId),
				memoryStorage.getFactLibraryEntries({ characterId: currentCharacterId, limit: 100 }),
				memoryApi.getSessions(20, currentCharacterId)
			]);
			facts = f;
			libraryEntries = l;
			sessions = s;
			turns = getWorkingMemory().turns.slice(-20);
		} catch (e) {
			console.error('[MemoryInspector] Failed to load:', e);
		} finally {
			isLoading = false;
		}
	}

	function formatDate(date: Date | undefined): string {
		if (!date) return '—';
		return new Date(date).toLocaleString('de-DE');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	async function handleRetroactiveTag() {
		if (turns.length === 0 || isTagging) return;
		isTagging = true;
		tagResult = null;
		try {
			tagResult = await retroactivelyTagSession(turns, currentCharacterId);
			if (tagResult.saved > 0) {
				await loadAll();
			}
		} catch (e) {
			console.error('[MemoryInspector] Retroactive tagging failed:', e);
		} finally {
			isTagging = false;
		}
	}

	function runParserTest(save: boolean) {
		if (!testUserMessage.trim() || !testLlmResponse.trim()) {
			testSaveResult = 'Please fill in both fields.';
			return;
		}
		testSaveResult = null;

		// 1. Parse and heuristic facts are shown immediately.
		let parsed: ReturnType<typeof parseResponse>;
		try {
			parsed = parseResponse(testLlmResponse);
		} catch (e) {
			parsed = { dialogue: '', stateUpdates: null, parseError: String(e) };
		}
		testParseResult = parsed;
		testPotentialFacts = extractPotentialFacts(parsed.dialogue, testUserMessage);

		// 2. Save directly if requested.
		if (save) {
			saveParsedFacts(parsed, testPotentialFacts);
		}

		// 3. Run extractor preview asynchronously so the UI never blocks.
		if (!parsed.stateUpdates?.newMemory) {
			isTesting = true;
			extractFactsFromLLM(testUserMessage, testLlmResponse)
				.then((extracted) => {
					testExtractorFacts = extracted.map((f) => f.content);
				})
				.catch((e) => {
					console.error('[MemoryInspector] Extractor preview failed:', e);
					testExtractorFacts = [];
				})
				.finally(() => {
					isTesting = false;
				});
		} else {
			testExtractorFacts = [];
			isTesting = false;
		}
	}

	async function saveParsedFacts(
		parsed: ReturnType<typeof parseResponse>,
		potentialFacts: string[]
	) {
		try {
			let saved = 0;
			if (parsed.stateUpdates?.newMemory) {
				await memoryApi.createFact({
					content: parsed.stateUpdates.newMemory,
					category: 'user',
					importance: 70,
					characterId: currentCharacterId
				});
				saved++;
			}
			if (parsed.stateUpdates?.structuredFactSeen) {
				const f = parsed.stateUpdates.structuredFactSeen;
				await memoryStorage.saveFactLibraryEntry({
					characterId: currentCharacterId,
					type: f.type,
					key: f.key,
					value: f.value,
					category: f.category,
					tags: f.tags,
					confidence: 0.75
				});
				saved++;
			}
			for (const factContent of potentialFacts) {
				await memoryApi.createFact({
					content: factContent,
					category: 'user',
					importance: 60,
					characterId: currentCharacterId
				});
				saved++;
			}
			await loadAll();
			testSaveResult = `${saved} fact(s) saved`;
		} catch (e) {
			console.error('[MemoryInspector] Save facts failed:', e);
			testSaveResult = `Save failed: ${e}`;
		}
	}

	function applyTemplate(template: { userMessage: string; llmResponse: string }) {
		testUserMessage = template.userMessage;
		testLlmResponse = template.llmResponse;
		testParseResult = null;
		testExtractorFacts = null;
		testPotentialFacts = null;
		testSaveResult = null;
	}

	$effect(() => {
		loadAll();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Memory Inspector">
	<div class="modal-container">
		<header class="modal-header">
			<div class="header-info">
				<Icon name="database" size={20} />
				<h2>Memory Inspector</h2>
			</div>
			<div class="header-actions">
				<button
					class="tag-btn"
					onclick={handleRetroactiveTag}
					disabled={turns.length === 0 || isTagging}
					aria-label="Extract memories from current session"
				>
					{#if isTagging}
						<div class="spinner-small"></div>
						Tagging...
					{:else}
						<Icon name="sparkles" size={16} />
						Extract memories
					{/if}
				</button>
				<button class="close-btn" onclick={onClose} aria-label="Close">
					<Icon name="x" size={20} />
				</button>
			</div>
		</header>

		{#if tagResult}
			<div class="tag-result">
				{#if tagResult.saved > 0}
					{tagResult.saved} new memory{tagResult.saved === 1 ? '' : 'ies'} saved
					{#if tagResult.skipped > 0}, {tagResult.skipped} duplicate{tagResult.skipped === 1 ? '' : 's'} skipped{/if}
				{:else}
					No new memories found
					{#if tagResult.skipped > 0}({tagResult.skipped} duplicate{tagResult.skipped === 1 ? '' : 's'} skipped){/if}
				{/if}
			</div>
		{/if}

		<div class="tabs">
			<button class="tab" class:active={activeTab === 'session'} onclick={() => (activeTab = 'session')}>Session</button>
			<button class="tab" class:active={activeTab === 'facts'} onclick={() => (activeTab = 'facts')}>Facts ({facts.length})</button>
			<button class="tab" class:active={activeTab === 'library'} onclick={() => (activeTab = 'library')}>Library ({libraryEntries.length})</button>
			<button class="tab" class:active={activeTab === 'sessions'} onclick={() => (activeTab = 'sessions')}>Sessions ({sessions.length})</button>
			<button class="tab" class:active={activeTab === 'state'} onclick={() => (activeTab = 'state')}>State</button>
			<button class="tab" class:active={activeTab === 'test'} onclick={() => (activeTab = 'test')}>Test</button>
		</div>

		<div class="modal-content">
			{#if isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<p>Loading memory...</p>
				</div>
			{:else if activeTab === 'session'}
				<section class="section">
					<h3>Current Session Turns ({turns.length})</h3>
					{#if turns.length === 0}
						<p class="empty">No turns in working memory yet.</p>
					{:else}
						<div class="turns-list">
							{#each turns as turn (turn.id ?? `${turn.role}-${turn.createdAt}`)}
								<div class="turn" class:user={turn.role === 'user'} class:assistant={turn.role === 'assistant'} class:system={turn.role === 'system'}>
									<span class="turn-role">{turn.role}</span>
									<span class="turn-time">{formatDate(turn.createdAt)}</span>
									<p class="turn-content">{turn.content}</p>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{:else if activeTab === 'facts'}
				<section class="section">
					<h3>Semantic Memory Facts ({facts.length})</h3>
					<p class="hint">Facts extracted automatically from conversation or heuristics.</p>
					{#if facts.length === 0}
						<p class="empty">No facts stored yet. The LLM must emit a memory tag for automatic extraction.</p>
					{:else}
						<div class="facts-list">
							{#each facts as fact (fact.id)}
								<div class="fact-card">
									<div class="fact-header">
										<span class="fact-category">{fact.category}</span>
										<span class="fact-meta">importance {fact.importance} · confidence {(fact.confidence * 100).toFixed(0)}%</span>
									</div>
									<p class="fact-content">{fact.content}</p>
									<div class="fact-footer">
										<span>refs: {fact.referenceCount}</span>
										<span>{formatDate(fact.createdAt)}</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{:else if activeTab === 'library'}
				<section class="section">
					<h3>Fact Library Entries ({libraryEntries.length})</h3>
					<p class="hint">Structured facts with type/key/value, usually emitted by the LLM as <code>structured_fact_seen</code>.</p>
					{#if libraryEntries.length === 0}
						<p class="empty">No fact library entries yet.</p>
					{:else}
						<div class="library-list">
							{#each libraryEntries as entry (entry.id)}
								<div class="library-card">
									<div class="library-header">
										<span class="library-type">{entry.type}</span>
										<span class="library-meta">confidence {(entry.confidence * 100).toFixed(0)}% · reviews {entry.reviewCount}</span>
									</div>
									<div class="library-key">{entry.key}</div>
									<div class="library-value">{entry.value}</div>
									{#if entry.category || entry.tags?.length}
										<div class="library-footer">
											{#if entry.category}<span>cat: {entry.category}</span>{/if}
											{#if entry.tags?.length}<span>tags: {entry.tags.join(', ')}</span>{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{:else if activeTab === 'sessions'}
				<section class="section">
					<h3>Past Session Summaries ({sessions.length})</h3>
					{#if sessions.length === 0}
						<p class="empty">No previous sessions summarized yet.</p>
					{:else}
						<div class="sessions-list">
							{#each sessions as session (session.id)}
								<div class="session-card">
									<div class="session-header">
										<span>{formatDate(session.startedAt)}</span>
										<span>{session.messageCount} messages</span>
									</div>
									{#if session.summary}
										<p class="session-summary">{session.summary}</p>
									{/if}
									{#if session.emotionalArc}
										<p class="session-arc">{session.emotionalArc}</p>
									{/if}
									{#if session.keyTopics?.length}
										<div class="session-topics">
											{#each session.keyTopics as topic}
												<span class="topic-tag">{topic}</span>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{:else if activeTab === 'state'}
				<section class="section">
					<h3>Current Character State</h3>
					<div class="state-grid">
						<div class="state-card">
							<span class="state-label">Name</span>
							<span class="state-value">{characterState.name}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Mode</span>
							<span class="state-value">{characterState.appMode}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Stage</span>
							<span class="state-value">{characterState.relationshipStage}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Mood</span>
							<span class="state-value">{characterState.mood.primary} ({characterState.mood.intensity})</span>
						</div>
						<div class="state-card">
							<span class="state-label">Energy</span>
							<span class="state-value">{characterState.energy}/100</span>
						</div>
						<div class="state-card">
							<span class="state-label">Affection</span>
							<span class="state-value">{characterState.affection}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Trust</span>
							<span class="state-value">{characterState.trust}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Intimacy</span>
							<span class="state-value">{characterState.intimacy}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Comfort</span>
							<span class="state-value">{characterState.comfort}</span>
						</div>
						<div class="state-card">
							<span class="state-label">Respect</span>
							<span class="state-value">{characterState.respect}</span>
						</div>
					</div>
				</section>
			{:else if activeTab === 'test'}
				<section class="section test-section">
					<h3>Memory Parser Tester</h3>
						<p class="hint">
							Paste a user message and a raw LLM response to see what the parser and
							extractor recognize — without waiting for a real conversation.
						</p>

						<div class="test-templates">
							<button class="template-btn" onclick={() => applyTemplate(TEMPLATES.noCodeblock)}>
								No codeblock
							</button>
							<button class="template-btn" onclick={() => applyTemplate(TEMPLATES.categoryList)}>
								Category list
							</button>
							<button class="template-btn" onclick={() => applyTemplate(TEMPLATES.correctCodeblock)}>
								Correct codeblock
							</button>
						</div>

						<div class="test-field">
							<label for="test-user-message">User message</label>
							<textarea
								id="test-user-message"
								bind:value={testUserMessage}
								rows={3}
								placeholder="Ich bin Softwareentwickler und mag Ramen"
							></textarea>
						</div>

						<div class="test-field">
							<label for="test-llm-response">LLM response</label>
							<textarea
								id="test-llm-response"
								bind:value={testLlmResponse}
								rows={8}
								placeholder="Paste the raw LLM response here, including any JSON blocks..."
							></textarea>
						</div>

						<div class="test-actions">
							<button
								class="test-btn"
								onclick={() => runParserTest(false)}
								disabled={isTesting || !testUserMessage.trim() || !testLlmResponse.trim()}
							>
								{#if isTesting}
									<div class="spinner-small"></div>
									Extractor running...
								{:else}
									Parse & Test
								{/if}
							</button>
							<button
								class="test-btn save"
								onclick={() => runParserTest(true)}
								disabled={isTesting || !testUserMessage.trim() || !testLlmResponse.trim()}
							>
								Parse & Save
							</button>
						</div>

						{#if testSaveResult}
							<div class="test-result success">{testSaveResult}</div>
						{/if}

						{#if testParseResult}
							<div class="test-result">
								<h4>Parse Result</h4>
								<div class="parse-row">
									<span class="parse-label">JSON detected:</span>
									<span class="parse-value">{!!testParseResult.stateUpdates ? '✅' : '❌'}</span>
								</div>
								<div class="parse-row">
									<span class="parse-label">new_memory:</span>
									<span class="parse-value">{testParseResult.stateUpdates?.newMemory ?? '—'}</span>
								</div>
								<div class="parse-row">
									<span class="parse-label">structured_fact_seen:</span>
									<span class="parse-value">
										{#if testParseResult.stateUpdates?.structuredFactSeen}
											{testParseResult.stateUpdates.structuredFactSeen.type}/{testParseResult.stateUpdates.structuredFactSeen.key}={testParseResult.stateUpdates.structuredFactSeen.value}
										{:else}
											—
										{/if}
									</span>
								</div>
								<div class="parse-row">
									<span class="parse-label">mood_change:</span>
									<span class="parse-value">
										{#if testParseResult.stateUpdates?.moodChange}
											{testParseResult.stateUpdates.moodChange.emotion} ({testParseResult.stateUpdates.moodChange.intensityDelta})
										{:else}
											—
										{/if}
									</span>
								</div>
								<div class="parse-row">
									<span class="parse-label">parseError:</span>
									<span class="parse-value">{testParseResult.parseError ?? '—'}</span>
								</div>
								<div class="parse-row vertical">
									<span class="parse-label">Cleaned dialogue:</span>
									<p class="parse-dialogue">{testParseResult.dialogue || '—'}</p>
								</div>
							</div>
						{/if}

						{#if testPotentialFacts !== null && testPotentialFacts.length > 0}
							<div class="test-result">
								<h4>Heuristic Facts ({testPotentialFacts.length})</h4>
								<ul>
									{#each testPotentialFacts as fact}
										<li>{fact}</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if testExtractorFacts !== null && testExtractorFacts.length > 0}
							<div class="test-result">
								<h4>Extractor Preview ({testExtractorFacts.length})</h4>
								<ul>
									{#each testExtractorFacts as fact}
										<li>{fact}</li>
									{/each}
								</ul>
							</div>
						{:else if testExtractorFacts !== null}
							<div class="test-result">Extractor would return no additional facts.</div>
						{/if}
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.modal-container {
		width: 800px;
		max-width: 95vw;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(245,245,245,0.98) 100%);
		border-radius: 20px;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
		overflow: hidden;
	}

	:global(.dark) .modal-container {
		background: linear-gradient(180deg, rgba(30,30,30,0.98) 0%, rgba(22,22,22,0.98) 100%);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		flex-shrink: 0;
	}

	:global(.dark) .modal-header {
		border-bottom-color: rgba(255, 255, 255, 0.08);
	}

	.header-info {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.header-info h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.close-btn {
		background: transparent;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		color: inherit;
		opacity: 0.6;
		transition: opacity 0.15s;
	}

	.close-btn:hover {
		opacity: 1;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.tag-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.75rem;
		border: none;
		border-radius: 10px;
		background: linear-gradient(135deg, #01B2FF, #7B61FF);
		color: white;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s, transform 0.1s;
	}

	.tag-btn:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.tag-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner-small {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.tag-result {
		padding: 0.5rem 1rem;
		margin: 0 1rem;
		border-radius: 10px;
		background: rgba(1, 178, 255, 0.12);
		color: #01B2FF;
		font-size: 0.8rem;
		font-weight: 500;
		text-align: center;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.75rem 1rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		flex-shrink: 0;
		overflow-x: auto;
	}

	:global(.dark) .tabs {
		border-bottom-color: rgba(255, 255, 255, 0.06);
	}

	.tab {
		background: transparent;
		border: none;
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary, #666);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.tab:hover {
		color: var(--text-primary, #111);
	}

	.tab.active {
		color: #01B2FF;
		border-bottom-color: #01B2FF;
	}

	.modal-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.section h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	.hint {
		margin: 0 0 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #666);
	}

	.empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-secondary, #888);
		font-style: italic;
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem;
		gap: 0.75rem;
	}

	.spinner {
		width: 28px;
		height: 28px;
		border: 3px solid rgba(1, 178, 255, 0.2);
		border-top-color: #01B2FF;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.turns-list,
	.facts-list,
	.library-list,
	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.turn {
		padding: 0.75rem;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .turn {
		background: rgba(255, 255, 255, 0.04);
	}

	.turn.user {
		border-left: 3px solid #01B2FF;
	}

	.turn.assistant {
		border-left: 3px solid #a855f7;
	}

	.turn.system {
		border-left: 3px solid #f59e0b;
	}

	.turn-role {
		font-size: 0.7rem;
		text-transform: uppercase;
		font-weight: 700;
		opacity: 0.7;
	}

	.turn-time {
		float: right;
		font-size: 0.7rem;
		opacity: 0.5;
	}

	.turn-content {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		line-height: 1.4;
		white-space: pre-wrap;
	}

	.fact-card,
	.library-card,
	.session-card {
		padding: 0.75rem;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .fact-card,
	:global(.dark) .library-card,
	:global(.dark) .session-card {
		background: rgba(255, 255, 255, 0.04);
	}

	.fact-header,
	.library-header,
	.session-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.75rem;
		margin-bottom: 0.4rem;
	}

	.fact-category,
	.library-type {
		font-weight: 600;
		text-transform: uppercase;
		color: #01B2FF;
	}

	.fact-meta,
	.library-meta {
		opacity: 0.6;
	}

	.fact-content,
	.library-value,
	.session-summary {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.4;
	}

	.library-key {
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.2rem;
	}

	.fact-footer,
	.library-footer {
		display: flex;
		gap: 1rem;
		font-size: 0.7rem;
		opacity: 0.5;
		margin-top: 0.4rem;
	}

	.session-arc {
		font-size: 0.8rem;
		font-style: italic;
		opacity: 0.7;
		margin: 0.4rem 0 0;
	}

	.session-topics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.5rem;
	}

	.topic-tag {
		font-size: 0.7rem;
		padding: 0.15rem 0.4rem;
		border-radius: 10px;
		background: rgba(1, 178, 255, 0.15);
		color: #01B2FF;
	}

	.state-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.state-card {
		display: flex;
		flex-direction: column;
		padding: 0.75rem;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.03);
	}

	:global(.dark) .state-card {
		background: rgba(255, 255, 255, 0.04);
	}

	.state-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		opacity: 0.6;
		margin-bottom: 0.2rem;
	}

	.state-value {
		font-size: 1rem;
		font-weight: 600;
	}

	.test-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.test-templates {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.template-btn {
		padding: 0.35rem 0.6rem;
		border: 1px solid rgba(1, 178, 255, 0.4);
		border-radius: 8px;
		background: rgba(1, 178, 255, 0.08);
		color: #01B2FF;
		font-size: 0.75rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.template-btn:hover {
		background: rgba(1, 178, 255, 0.15);
	}

	.test-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.test-field label {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.test-field textarea {
		padding: 0.6rem;
		border-radius: 10px;
		border: 1px solid rgba(0, 0, 0, 0.1);
		background: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		resize: vertical;
		min-height: 60px;
	}

	:global(.dark) .test-field textarea {
		background: rgba(30, 30, 30, 0.6);
		border-color: rgba(255, 255, 255, 0.1);
		color: inherit;
	}

	.test-actions {
		display: flex;
		gap: 0.5rem;
	}

	.test-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		flex: 1;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 10px;
		background: linear-gradient(135deg, #01B2FF, #7B61FF);
		color: white;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.test-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.test-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.test-btn.save {
		background: linear-gradient(135deg, #22c55e, #16a34a);
	}

	.test-result {
		padding: 0.75rem;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.03);
		font-size: 0.85rem;
	}

	:global(.dark) .test-result {
		background: rgba(255, 255, 255, 0.04);
	}

	.test-result.success {
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
		font-weight: 600;
	}

	.test-result h4 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}

	.parse-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.2rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
	}

	.parse-row.vertical {
		flex-direction: column;
	}

	.parse-label {
		font-weight: 600;
		min-width: 140px;
		color: var(--text-secondary);
	}

	.parse-value {
		word-break: break-word;
	}

	.parse-dialogue {
		margin: 0.25rem 0 0;
		padding: 0.5rem;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.04);
		white-space: pre-wrap;
	}
</style>

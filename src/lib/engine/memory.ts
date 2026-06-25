import type {
	Fact,
	SessionSummary,
	ConversationTurn,
	RelevantContext,
	WorkingMemory,
	MemorySearchOptions,
	NewFact,
	MemoryBudget
} from '$lib/types/memory';
import {
	MAX_WORKING_MEMORY_TURNS,
	MAX_RELEVANT_FACTS,
	MAX_RECENT_SESSIONS,
	DEFAULT_FACT_IMPORTANCE,
	DEFAULT_FACT_CONFIDENCE,
	getMemoryBudget
} from '$lib/types/memory';
import * as memoryStorage from '$lib/services/storage/memory';
import { embedText, findSimilarFacts, isEmbeddingReady, cosineSimilarity } from '$lib/services/embeddings';
import { extractFactsFromLLM } from '$lib/services/memory/extract-facts';
import { retroactivelyTagSession } from '$lib/services/memory/retroactive-tag';
import { determineFactCategory, calculateFactImportance } from '$lib/utils/memory-helpers';
import { generateSessionSummary } from '$lib/services/memory/summarize-session';
import { analyzePersonalityEvolution } from '$lib/services/memory/analyze-personality-evolution';
import { modulesStore } from '$lib/stores/modules.svelte';

// Session inactivity threshold (30 minutes)
const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

// Shared character ID for user facts visible to all characters
export const SHARED_CHARACTER_ID = 'shared';

function getCurrentMemoryBudget(): MemoryBudget {
	const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
	const contextSize = Number(consciousnessSettings.contextSize) || 32768;
	return getMemoryBudget(contextSize);
}

// Working memory store (single instance for the session)
let workingMemory: WorkingMemory = {
	turns: [],
	sessionStartedAt: new Date(),
	messageCount: 0
};

// Initialize working memory
export function initWorkingMemory(): WorkingMemory {
	workingMemory = {
		turns: [],
		sessionStartedAt: new Date(),
		messageCount: 0
	};
	return workingMemory;
}

// Get working memory
export function getWorkingMemory(): WorkingMemory {
	return workingMemory;
}

// Check if a new session should start (lazy compaction trigger)
export function shouldStartNewSession(lastInteraction: Date | null): boolean {
	if (!lastInteraction) return true;
	return Date.now() - new Date(lastInteraction).getTime() > SESSION_INACTIVITY_MS;
}

// Add a turn to working memory
export function addTurnToWorkingMemory(turn: Omit<ConversationTurn, 'id'>): void {
	workingMemory.turns.push({
		...turn,
		createdAt: new Date()
	} as ConversationTurn);

	// Trim to max size
	if (workingMemory.turns.length > MAX_WORKING_MEMORY_TURNS) {
		workingMemory.turns = workingMemory.turns.slice(-MAX_WORKING_MEMORY_TURNS);
	}

	workingMemory.messageCount++;
}

// Get recent turns from working memory
export function getRecentTurns(limit: number = 10): ConversationTurn[] {
	return workingMemory.turns.slice(-limit);
}

// Clear working memory (call on session end)
export function clearWorkingMemory(): void {
	workingMemory = {
		turns: [],
		sessionStartedAt: new Date(),
		messageCount: 0,
		currentSessionId: undefined
	};
}

// Hydrate working memory from IndexedDB (call on page load)
export async function hydrateWorkingMemory(characterId: string = 'default'): Promise<void> {
	if (workingMemory.turns.length > 0) return;

	const budget = getCurrentMemoryBudget();

	// Find the most recent open session (not ended) for this character
	const openSessions = await memoryStorage.getSessions({ characterId, ended: false, limit: 1 });
	const currentSession = openSessions[0];

	if (currentSession) {
		// Only load turns belonging to the current open session
		const recentTurns = await memoryStorage.getConversationTurns({
			sessionId: currentSession.id,
			characterId,
			limit: budget.workingMemoryTurns
		});
		workingMemory.turns = recentTurns;
		workingMemory.messageCount = recentTurns.length;
		workingMemory.currentSessionId = currentSession.id;
	} else {
		// No open session — start fresh
		workingMemory.turns = [];
		workingMemory.messageCount = 0;
		workingMemory.currentSessionId = undefined;
	}
}

// Analyze sessions for personality evolution suggestions
export interface EvolutionSuggestion {
	adaptation: string;
	reason: string;
}

export async function analyzeEvolution(
	sessions: SessionSummary[],
	currentPersonality: import('$lib/types/character').PersonalityProfile,
	companionName?: string,
	language?: string
): Promise<EvolutionSuggestion[]> {
	if (sessions.length === 0) return [];

	// Use LLM-based analysis for richer, context-aware suggestions
	try {
		const suggestions = await analyzePersonalityEvolution(
			sessions,
			currentPersonality,
			companionName || 'Companion',
			language
		);
		return suggestions;
	} catch (e) {
		console.error('[Evolution] LLM analysis failed, falling back to empty suggestions:', e);
		return [];
	}
}

// Lazy session compaction: compact previous open session before starting a new one
export async function compactOpenSession(
	characterId: string = 'default',
	companionName?: string,
	onEvolutionTrigger?: () => void
): Promise<SessionSummary | null> {
	try {
		// Find the most recent open session (no endedAt)
		const openSessions = await memoryStorage.getSessions({
			characterId,
			ended: false,
			limit: 1
		});

		const openSession = openSessions[0];
		if (!openSession || !openSession.id) return null;

		// Get all turns for this session
		const turns = await memoryStorage.getConversationTurns({
			sessionId: openSession.id,
			characterId
		});

		if (turns.length === 0) {
			// No turns, just mark as ended
			await memoryStorage.updateSession(openSession.id, { endedAt: new Date() });
			return { ...openSession, endedAt: new Date() };
		}

		// Generate summary via LLM (with fallback to heuristic)
		const llmSummary = await generateSessionSummary(turns, companionName || 'Companion');

		// Generate embedding for the summary
		let embedding: number[] | undefined;
		if (isEmbeddingReady()) {
			const embedTextContent = llmSummary.summary + ' ' + llmSummary.keyTopics.join(' ');
			const result = await embedText(embedTextContent);
			if (result) embedding = result;
		}

		// Update the session
		await memoryStorage.updateSession(openSession.id, {
			summary: llmSummary.summary,
			keyTopics: llmSummary.keyTopics.slice(0, 5),
			emotionalArc: llmSummary.emotionalArc,
			messageCount: turns.length,
			endedAt: new Date(),
			embedding
		});

		const compactedSession: SessionSummary = {
			...openSession,
			summary: llmSummary.summary,
			keyTopics: llmSummary.keyTopics.slice(0, 5),
			emotionalArc: llmSummary.emotionalArc,
			messageCount: turns.length,
			endedAt: new Date(),
			embedding
		};

		// Trigger evolution check via callback (store-level logic handles the rest)
		if (onEvolutionTrigger) {
			onEvolutionTrigger();
		}

		return compactedSession;
	} catch (e) {
		console.error('[Memory] Failed to compact open session:', e);
		return null;
	}
}

// Start a new session (after compacting any open one)
export async function startNewSession(
	characterId: string = 'default',
	companionName?: string
): Promise<SessionSummary> {
	// Compact any open session first
	await compactOpenSession(characterId, companionName);

	// Create new session
	const now = new Date();
	const id = await memoryStorage.saveSession({
		characterId,
		summary: '',
		keyTopics: [],
		messageCount: 0,
		emotionalArc: '',
		startedAt: now
	});

	const session: SessionSummary = {
		id,
		characterId,
		summary: '',
		keyTopics: [],
		messageCount: 0,
		emotionalArc: '',
		startedAt: now
	};

	workingMemory.currentSessionId = id;
	workingMemory.sessionStartedAt = now;
	return session;
}

// Memory API - uses IndexedDB storage directly
export const memoryApi = {
	// Get facts from IndexedDB
	async getFacts(limit: number = 50, characterId: string = 'default'): Promise<Fact[]> {
		return memoryStorage.getFacts({ limit, characterId });
	},

	// Get sessions from IndexedDB
	async getSessions(
		limit: number = 10,
		characterId: string = 'default'
	): Promise<SessionSummary[]> {
		return memoryStorage.getSessions({ limit, characterId });
	},

	// Search facts by keywords
	async searchFacts(
		query: string,
		options: MemorySearchOptions = {},
		characterId: string = 'default'
	): Promise<Fact[]> {
		const keywords = query.split(/\s+/).filter((w) => w.length > 2);
		return memoryStorage.getFacts({
			...options,
			characterId,
			keywords: keywords.length > 0 ? keywords : undefined
		});
	},

	// Create a new fact
	async createFact(fact: NewFact): Promise<Fact> {
		const id = await memoryStorage.saveFact({
			...fact,
			importance: fact.importance ?? DEFAULT_FACT_IMPORTANCE,
			confidence: fact.confidence ?? DEFAULT_FACT_CONFIDENCE
		});
		// Return the created fact (fetch directly by ID to avoid sort-order mismatch)
		const created = await memoryStorage.getFactById(id);
		if (created) return created;
		// Fallback (should never happen — the fact was just saved)
		return {
			id,
			...fact,
			importance: fact.importance ?? DEFAULT_FACT_IMPORTANCE,
			confidence: fact.confidence ?? DEFAULT_FACT_CONFIDENCE,
			referenceCount: 0,
			createdAt: new Date()
		};
	},

	// Delete a single fact by ID
	async deleteFact(factId: number): Promise<void> {
		await memoryStorage.deleteFact(factId);
	},

	// Delete all facts for a character (or globally if no characterId)
	async deleteAllFacts(characterId?: string): Promise<number> {
		const facts = await memoryStorage.getFacts({ characterId, limit: 100000 });
		await Promise.all(facts.map((f) => memoryStorage.deleteFact(f.id!)));
		return facts.length;
	},

	// Create a new session
	async createSession(characterId?: string): Promise<SessionSummary> {
		const now = new Date();
		const id = await memoryStorage.saveSession({
			characterId: characterId ?? 'default',
			summary: '',
			keyTopics: [],
			messageCount: 0,
			emotionalArc: '',
			startedAt: now
		});
		return {
			id,
			characterId: characterId ?? 'default',
			summary: '',
			keyTopics: [],
			messageCount: 0,
			emotionalArc: '',
			startedAt: now
		};
	},

	// Save a conversation turn
	async saveTurn(turn: Omit<ConversationTurn, 'id' | 'createdAt'>): Promise<ConversationTurn> {
		const now = new Date();
		const id = await memoryStorage.saveConversationTurn({
			...turn,
			createdAt: now
		});
		return {
			id,
			...turn,
			createdAt: now
		};
	},

	/**
	 * Fallback fact extraction when the main LLM did not emit a new_memory tag.
	 * Uses a slim, dedicated LLM call and stores only facts that are not already
	 * known (deduplicated by embedding similarity).
	 */
	async maybeExtractFacts(
		userMessage: string,
		assistantResponse: string,
		characterId: string = 'default',
		hasNewMemory: boolean = false
	): Promise<number> {
		if (hasNewMemory) return 0;
		if (!userMessage.trim() || !assistantResponse.trim()) return 0;
		// Skip small talk / acknowledgements / emojis that are unlikely to contain facts.
		const wordCount = userMessage.trim().split(/\s+/).length;
		if (wordCount < 5) return 0;

		try {
			const extracted = await extractFactsFromLLM(userMessage, assistantResponse);
			if (extracted.length === 0) return 0;

			// Get existing facts for deduplication
			const existingFacts = [
				...(await memoryStorage.getFacts({ characterId, limit: 1000 })),
				...(await memoryStorage.getFacts({ characterId: SHARED_CHARACTER_ID, limit: 1000 }))
			];

			let saved = 0;
			for (const fact of extracted) {
				const category = fact.category || determineFactCategory(fact.content);
				const importance = fact.importance ?? calculateFactImportance(fact.content);

				// Deduplicate by embedding similarity
				if (isEmbeddingReady()) {
					const embedding = await embedText(fact.content);
					if (embedding) {
						const existingWithEmbeddings = existingFacts.filter(
							(f) => f.embedding && f.embedding.length > 0
						);
						const similar = existingWithEmbeddings.some(
							(f) => cosineSimilarity(embedding, f.embedding!) > 0.9
						);
						if (similar) continue;
					}
				}

				const targetCharacterId = category === 'user' ? SHARED_CHARACTER_ID : characterId;
				await memoryStorage.saveFact({
					content: fact.content,
					category,
					importance,
					confidence: fact.confidence ?? 0.7,
					source: 'llm-extractor',
					characterId: targetCharacterId
				});
				saved++;
			}

			return saved;
		} catch (e) {
			console.warn('[Memory] maybeExtractFacts failed:', e);
			return 0;
		}
	}
};

// Retrieve relevant context for prompt building
export async function retrieveRelevantContext(
	userMessage: string,
	characterId: string = 'default'
): Promise<RelevantContext> {
	const budget = getCurrentMemoryBudget();

	// Get recent turns from working memory
	const recentTurns = getRecentTurns(budget.workingMemoryTurns);

	// Search for relevant facts based on user message
	let relevantFacts: Fact[] = [];
	let triggeredMemories: Fact[] = [];
	let queryEmbedding: number[] | null = null;

	try {
		// Try semantic search first if embedding model is ready
		if (isEmbeddingReady()) {
			queryEmbedding = await embedText(userMessage);
			if (queryEmbedding) {
				// Get character-specific + shared facts for semantic search
				const characterFacts = await memoryStorage.getFacts({ characterId, limit: 1000 });
				const sharedFacts = await memoryStorage.getFacts({
					characterId: SHARED_CHARACTER_ID,
					limit: 1000
				});
				const allFacts = [...characterFacts, ...sharedFacts];
				const factsWithEmbeddings = allFacts.filter((f) => f.embedding && f.embedding.length > 0);

				const semanticResults = findSimilarFacts(
					queryEmbedding,
					factsWithEmbeddings,
					budget.relevantFacts,
					{
						similarityWeight: 0.7,
						importanceWeight: 0.3,
						minSimilarity: 0.3
					}
				);
				relevantFacts = semanticResults.map((r) => r.fact);

				// For triggered memories, use higher similarity threshold
				const triggerWords = extractTriggerWords(userMessage);
				if (triggerWords.length > 0) {
					const triggerQuery = triggerWords.join(' ');
					const triggerEmbedding = await embedText(triggerQuery);
					if (triggerEmbedding) {
						const triggerResults = findSimilarFacts(triggerEmbedding, factsWithEmbeddings, budget.relevantFacts, {
							similarityWeight: 0.6,
							importanceWeight: 0.4,
							minSimilarity: 0.5
						});
						triggeredMemories = triggerResults
							.map((r) => r.fact)
							.filter((t) => !relevantFacts.some((r) => r.id === t.id));
					}
				}
			}
		}

		// Fall back to keyword search if semantic search didn't work or returned nothing
		if (relevantFacts.length === 0) {
			// Get high-importance facts (always include these regardless of keywords)
			const importantFacts = await memoryStorage.getFacts({ limit: 5, characterId });
			const sharedImportantFacts = await memoryStorage.getFacts({
				limit: 5,
				characterId: SHARED_CHARACTER_ID
			});

			// Search by keywords in user message
			const keywords = userMessage.split(/\s+/).filter((w) => w.length > 2);
			const keywordFacts = await memoryStorage.getFacts({
				characterId,
				limit: budget.relevantFacts,
				keywords: keywords.length > 0 ? keywords : undefined
			});
			const sharedKeywordFacts = await memoryStorage.getFacts({
				characterId: SHARED_CHARACTER_ID,
				limit: budget.relevantFacts,
				keywords: keywords.length > 0 ? keywords : undefined
			});

			// Merge important facts with keyword-matched facts, dedupe by id
			const allFacts = [...importantFacts, ...sharedImportantFacts];
			for (const fact of [...keywordFacts, ...sharedKeywordFacts]) {
				if (!allFacts.some((f) => f.id === fact.id)) {
					allFacts.push(fact);
				}
			}
			relevantFacts = allFacts.slice(0, budget.relevantFacts);

			// Check for triggered memories (specific keywords)
			const triggerWords = extractTriggerWords(userMessage);
			if (triggerWords.length > 0) {
				const triggered = await memoryStorage.getFacts({
					characterId,
					minImportance: 70,
					limit: budget.relevantFacts,
					keywords: triggerWords
				});
				const sharedTriggered = await memoryStorage.getFacts({
					characterId: SHARED_CHARACTER_ID,
					minImportance: 70,
					limit: budget.relevantFacts,
					keywords: triggerWords
				});
				triggeredMemories = [...triggered, ...sharedTriggered].filter(
					(t) => !relevantFacts.some((r) => r.id === t.id)
				);
			}
		}
	} catch (e) {
		console.error('[Memory] Failed to fetch relevant facts:', e);
	}

	// Get relevant sessions via semantic search
	let recentSessions: SessionSummary[] = [];
	try {
		const allSessions = await memoryStorage.getSessions({
			characterId,
			ended: true,
			limit: 50
		});

		if (isEmbeddingReady()) {
			const sessionQueryEmbedding = queryEmbedding ?? (await embedText(userMessage));
			if (sessionQueryEmbedding) {
				const sessionsWithEmbeddings = allSessions.filter(
					(s) => s.embedding && s.embedding.length > 0
				);
				const results: Array<{ session: SessionSummary; similarity: number }> = [];
				for (const session of sessionsWithEmbeddings) {
					if (!session.embedding) continue;
					const similarity = cosineSimilarity(sessionQueryEmbedding, session.embedding);
					if (similarity >= 0.35) {
						results.push({ session, similarity });
					}
				}
				results.sort((a, b) => b.similarity - a.similarity);
				recentSessions = results.slice(0, budget.recentSessions).map((r) => r.session);
			}
		}

		// Fallback: if no semantic matches, return most recent session
		if (recentSessions.length === 0 && allSessions.length > 0) {
			recentSessions = allSessions.slice(0, 1);
		}
	} catch (e) {
		console.error('Failed to fetch recent sessions:', e);
	}

	// Retrieve relevant fact library entries
	let factLibraryEntries: import('$lib/types/memory').FactLibraryEntry[] = [];
	try {
		const keywords = userMessage.split(/\s+/).filter((w) => w.length > 3);
		const entries = await memoryStorage.getFactLibraryEntries({
			characterId,
			limit: budget.factLibraryEntries,
			keywords: keywords.length > 0 ? keywords : undefined,
			embedding: queryEmbedding || undefined
		});
		factLibraryEntries = entries;
	} catch (e) {
		console.error('[Memory] Failed to fetch fact library entries:', e);
	}

	// Increment reference counts for retrieved facts
	const allRetrievedFacts = [...relevantFacts, ...triggeredMemories];
	for (const fact of allRetrievedFacts) {
		if (fact.id !== undefined) {
			memoryStorage.incrementFactReference(fact.id);
		}
	}

	return {
		recentTurns,
		relevantFacts,
		triggeredMemories,
		recentSessions,
		factLibraryEntries
	};
}

// Extract trigger words from a message
function extractTriggerWords(message: string): string[] {
	const triggers: string[] = [];
	const lowerMessage = message.toLowerCase();

	// Personal triggers
	const personalPatterns = [
		/\b(remember|recall|forgot|forget)\s+(?:when|that|about)\s+([^.!?]+)/gi,
		/\b(last time|before|earlier|yesterday|ago)\b/gi,
		/\b(you said|you mentioned|you told)\b/gi
	];

	for (const pattern of personalPatterns) {
		let match;
		while ((match = pattern.exec(lowerMessage)) !== null) {
			if (match[2]) {
				triggers.push(match[2].trim());
			}
		}
	}

	// Name extraction (might trigger facts about the user)
	// Exclude common sentence-start words to avoid false positives like "What", "The"
	const COMMON_WORDS = new Set([
		'The','This','That','These','Those','There','They','Then','Than',
		'What','When','Where','Why','How','Who','Whose','Which',
		'You','Your','Yours','We','Our','Us','I','My','Me','Mine',
		'He','His','Him','She','Her','Hers','It','Its','They','Their','Them',
		'A','An','And','As','At','Are','Am','Is','Was','Were','Be','Been','Being',
		'Have','Has','Had','Do','Does','Did','Will','Would','Could','Should',
		'May','Might','Must','Can','Shall','Need','Dare','Ought','Used',
		'If','In','Into','On','Of','Or','For','From','By','With','Without',
		'About','Above','Across','After','Against','Along','Among','Around',
		'Before','Behind','Below','Beneath','Beside','Between','Beyond',
		'Down','During','Except','Inside','Outside','Over','Through','To','Toward',
		'Under','Until','Up','Upon','Within','Not','No','Now','Nor','But','So','Yet',
		'Yes','Just','Only','Also','Too','Very','Really','Actually','Probably',
		'Please','Thanks','Thank','Sorry','Hello','Hi','Hey','Goodbye','Bye',
		'Here','Today','Yesterday','Tomorrow','Always','Sometimes','Never',
		'Often','Usually','Already','Still','Even','Ever','Once','Twice',
		'Some','Any','All','None','Many','Much','More','Most','Less','Least',
		'Few','Several','Both','Either','Neither','Each','Every','Other','Another',
		'Such','Same','Different','Own','Same','Last','First','Next','Previous',
		'New','Old','Young','Big','Small','Long','Short','High','Low','Good','Bad',
		'Great','Little','Large','Early','Late','Right','Wrong','True','False',
		'Possible','Impossible','Available','Certain','Sure','Likely','Unlikely',
		'Happy','Glad','Sad','Sorry','Nice','Fine','Okay','Ok','Well','Better',
		'Best','Worse','Worst','Pretty','Quite','Rather','Fairly','Almost',
		'Definitely','Absolutely','Certainly','Exactly','Perhaps','Maybe'
	]);
	const namePattern = /\b([A-Z][a-z]+)\b/g;
	let nameMatch;
	while ((nameMatch = namePattern.exec(message)) !== null) {
		if (!COMMON_WORDS.has(nameMatch[1])) {
			triggers.push(nameMatch[1]);
		}
	}

	return triggers.filter((t) => t.length > 2);
}

// Extract potential facts from a conversation
export function extractFactsFromConversation(
	userMessage: string,
	companionResponse: string
): string[] {
	const facts: string[] = [];

	// User statements about themselves
	const userSelfPatterns = [
		/\bI(?:'m| am)\s+(a |an )?([^.!?,]+)/gi,
		/\bmy (?:name|job|hobby|favorite|family) is\s+([^.!?,]+)/gi,
		/\bI (?:work|live|study) (?:at|in|as)\s+([^.!?,]+)/gi,
		/\bI (?:like|love|enjoy|hate|prefer)\s+([^.!?,]+)/gi
	];

	for (const pattern of userSelfPatterns) {
		let match;
		while ((match = pattern.exec(userMessage)) !== null) {
			const fact = match[match.length - 1].trim();
			if (fact.length > 3 && fact.length < 150) {
				facts.push(`User: ${fact}`);
			}
		}
	}

	// Companion acknowledgments of facts
	const acknowledgmentPatterns = [
		/I(?:'ll)? remember\s+([^.!?]+)/gi,
		/so you(?:'re| are)\s+([^.!?,]+)/gi,
		/you (?:like|love|enjoy)\s+([^.!?,]+)/gi
	];

	for (const pattern of acknowledgmentPatterns) {
		let match;
		while ((match = pattern.exec(companionResponse)) !== null) {
			const fact = match[1].trim();
			if (fact.length > 3 && fact.length < 150 && !facts.some((f) => f.includes(fact))) {
				facts.push(fact);
			}
		}
	}

	return facts;
}

// Re-export helpers so existing imports keep working.
export { determineFactCategory, calculateFactImportance } from '$lib/utils/memory-helpers';

// Backfill embeddings for facts that don't have them
export async function backfillEmbeddings(
	onProgress?: (done: number, total: number) => void
): Promise<{ success: number; failed: number }> {
	if (!isEmbeddingReady()) {
		return { success: 0, failed: 0 };
	}

	const factsWithoutEmbeddings = await memoryStorage.getFactsWithoutEmbeddings();
	let success = 0;
	let failed = 0;

	for (let i = 0; i < factsWithoutEmbeddings.length; i++) {
		const fact = factsWithoutEmbeddings[i];
		if (fact.id === undefined) continue;

		try {
			const embedding = await embedText(fact.content);
			if (embedding) {
				await memoryStorage.updateFactEmbedding(fact.id, embedding);
				success++;
			} else {
				failed++;
			}
		} catch {
			failed++;
		}

		onProgress?.(i + 1, factsWithoutEmbeddings.length);
	}

	return { success, failed };
}

// Check if there are facts without embeddings
export async function getEmbeddingBackfillStatus(): Promise<{
	total: number;
	withEmbeddings: number;
	withoutEmbeddings: number;
}> {
	const allFacts = await memoryStorage.getAllFactsWithEmbeddings();
	const withEmbeddings = allFacts.filter((f) => f.embedding && f.embedding.length > 0).length;
	return {
		total: allFacts.length,
		withEmbeddings,
		withoutEmbeddings: allFacts.length - withEmbeddings
	};
}

// Re-export retroactive tagging so UI components can trigger it easily.
export { retroactivelyTagSession };

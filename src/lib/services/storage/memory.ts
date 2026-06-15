import {
	db,
	type DBFact,
	type DBSessionSummary,
	type DBConversationTurn,
	type DBFactLibraryEntry
} from '$lib/db';
import type {
	Fact,
	SessionSummary,
	ConversationTurn,
	MemorySearchOptions,
	NewFact,
	FactLibraryEntry,
	FactLibrarySearchOptions
} from '$lib/types/memory';
import { embedText, isEmbeddingReady } from '$lib/services/embeddings';

const DEFAULT_CHARACTER_ID = 'default';

// Facts

export async function getFacts(
	options: MemorySearchOptions & { characterId?: string } = {}
): Promise<Fact[]> {
	// Use index-based queries when possible to avoid loading all facts into memory.
	let facts: DBFact[];

	if (options.characterId) {
		// characterId is indexed — most restrictive filter first
		facts = await db.facts.where('characterId').equals(options.characterId).toArray();
	} else if (options.category) {
		// category is indexed
		facts = await db.facts.where('category').equals(options.category).toArray();
	} else {
		// No indexed filter available — fall back to full table scan
		facts = await db.facts.toArray();
	}

	let filtered = facts;

	// Apply remaining filters client-side
	if (options.characterId && !options.category) {
		// characterId already filtered by index above; skip redundant check
	} else if (options.characterId) {
		filtered = filtered.filter((f) => f.characterId === options.characterId);
	}

	if (options.category) {
		filtered = filtered.filter((f) => f.category === options.category);
	}

	if (options.minImportance !== undefined) {
		filtered = filtered.filter((f) => f.importance >= options.minImportance!);
	}

	// Filter by keywords (case-insensitive content search)
	if (options.keywords && options.keywords.length > 0) {
		const lowerKeywords = options.keywords.map((k) => k.toLowerCase());
		filtered = filtered.filter((f) =>
			lowerKeywords.some((kw) => f.content.toLowerCase().includes(kw))
		);
	}

	// Sort by importance (descending), then by referenceCount, then by recency
	filtered.sort((a, b) => {
		if (b.importance !== a.importance) return b.importance - a.importance;
		if (b.referenceCount !== a.referenceCount) return b.referenceCount - a.referenceCount;
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});

	// Apply limit
	if (options.limit) {
		filtered = filtered.slice(0, options.limit);
	}

	return filtered.map(deserializeFact);
}

function normalizeFactContent(content: string): string {
	return content
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function mergeFactContent(existing: string, incoming: string): string {
	// Keep the longer, more informative version if one is a superset of the other.
	const normExisting = normalizeFactContent(existing);
	const normIncoming = normalizeFactContent(incoming);
	if (normExisting === normIncoming) return existing;
	if (normExisting.includes(normIncoming)) return existing;
	if (normIncoming.includes(normExisting)) return incoming;
	return incoming;
}

async function findDuplicateFact(
	content: string,
	characterId: string,
	category?: string
): Promise<Fact | undefined> {
	const normalized = normalizeFactContent(content);
	const candidates = await db.facts
		.where('characterId')
		.equals(characterId)
		.filter((f) => !category || f.category === category)
		.toArray();

	for (const candidate of candidates) {
		if (normalizeFactContent(candidate.content) === normalized) {
			return deserializeFact(candidate);
		}
	}

	return undefined;
}

export async function saveFact(
	fact: NewFact & { characterId?: string }
): Promise<number> {
	const now = new Date();
	const characterId = fact.characterId ?? DEFAULT_CHARACTER_ID;

	// Try to merge with an existing fact before creating a new one.
	const duplicate = await findDuplicateFact(fact.content, characterId, fact.category);
	if (duplicate && duplicate.id !== undefined) {
		const newConfidence = Math.min(
			1,
			Math.max(duplicate.confidence, fact.confidence ?? duplicate.confidence) + 0.05
		);
		const updates: Partial<DBFact> = {
			content: mergeFactContent(duplicate.content, fact.content),
			confidence: newConfidence,
			lastAccessed: now,
			referenceCount: duplicate.referenceCount + 1
		};
		// Refresh embedding when content changed and embeddings are available.
		if (isEmbeddingReady()) {
			const mergedContent = updates.content ?? duplicate.content;
			const result = await embedText(mergedContent);
			if (result) updates.embedding = result;
		}
		await db.facts.update(duplicate.id, updates);
		return duplicate.id;
	}

	// Generate embedding if model is ready
	let embedding: number[] | undefined;
	if (isEmbeddingReady()) {
		const result = await embedText(fact.content);
		if (result) {
			embedding = result;
		}
	}

	const dbFact: Omit<DBFact, 'id'> = {
		characterId,
		content: fact.content,
		category: fact.category,
		importance: fact.importance ?? 50,
		confidence: fact.confidence ?? 0.8,
		source: fact.source,
		referenceCount: 0,
		createdAt: now,
		embedding
	};

	const id = await db.facts.add(dbFact);
	return id as number;
}

export async function getFactById(factId: number): Promise<Fact | undefined> {
	const fact = await db.facts.get(factId);
	return fact ? deserializeFact(fact) : undefined;
}

export async function incrementFactReference(factId: number): Promise<void> {
	const fact = await db.facts.get(factId);
	if (fact) {
		await db.facts.update(factId, {
			referenceCount: fact.referenceCount + 1,
			lastAccessed: new Date()
		});
	}
}

export async function deleteFact(factId: number): Promise<void> {
	await db.facts.delete(factId);
}

export async function deleteAllFacts(): Promise<void> {
	await db.facts.clear();
}

export async function updateFactEmbedding(factId: number, embedding: number[]): Promise<void> {
	await db.facts.update(factId, { embedding });
}

export async function getFactsWithoutEmbeddings(): Promise<Fact[]> {
	const facts = await db.facts.toArray();
	return facts
		.filter((f) => !f.embedding || f.embedding.length === 0)
		.map(deserializeFact);
}

export async function getAllFactsWithEmbeddings(): Promise<Fact[]> {
	const facts = await db.facts.toArray();
	return facts.map(deserializeFact);
}

// Sessions

export async function getSessions(
	options: { limit?: number; characterId?: string; ended?: boolean } = {}
): Promise<SessionSummary[]> {
	let sessions = await db.sessions.toArray();

	// Filter by characterId
	if (options.characterId) {
		sessions = sessions.filter((s) => s.characterId === options.characterId);
	}

	// Filter by ended status
	if (options.ended === true) {
		sessions = sessions.filter((s) => s.endedAt !== undefined);
	} else if (options.ended === false) {
		sessions = sessions.filter((s) => s.endedAt === undefined);
	}

	// Sort by startedAt descending (most recent first)
	sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

	if (options.limit) {
		sessions = sessions.slice(0, options.limit);
	}

	return sessions.map(deserializeSession);
}

export async function saveSession(
	session: Omit<SessionSummary, 'id'> & { characterId?: string }
): Promise<number> {
	const dbSession: Omit<DBSessionSummary, 'id'> = {
		...session,
		characterId: session.characterId ?? DEFAULT_CHARACTER_ID,
		startedAt: new Date(session.startedAt),
		endedAt: session.endedAt ? new Date(session.endedAt) : undefined
	};

	const id = await db.sessions.add(dbSession);
	return id as number;
}

export async function updateSession(
	sessionId: number,
	updates: Partial<SessionSummary>
): Promise<void> {
	const serialized: Partial<DBSessionSummary> = { ...updates };
	if (updates.startedAt) serialized.startedAt = new Date(updates.startedAt);
	if (updates.endedAt) serialized.endedAt = new Date(updates.endedAt);

	await db.sessions.update(sessionId, serialized);
}

export async function deleteAllSessions(): Promise<void> {
	await db.sessions.clear();
}

// Conversation Turns

export async function getConversationTurns(
	options: { sessionId?: number; limit?: number; characterId?: string } = {}
): Promise<ConversationTurn[]> {
	let turns: DBConversationTurn[];

	if (options.sessionId !== undefined) {
		turns = await db.conversationTurns.where('sessionId').equals(options.sessionId).toArray();
	} else {
		turns = await db.conversationTurns.toArray();
	}

	// Filter by characterId
	if (options.characterId) {
		turns = turns.filter((t) => t.characterId === options.characterId);
	}

	// Sort by createdAt ascending (chronological order)
	turns.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

	if (options.limit) {
		// Take the most recent N turns
		turns = turns.slice(-options.limit);
	}

	return turns.map(deserializeTurn);
}

export async function saveConversationTurn(
	turn: Omit<ConversationTurn, 'id'> & { characterId?: string }
): Promise<number> {
	const dbTurn: Omit<DBConversationTurn, 'id'> = {
		...turn,
		characterId: turn.characterId ?? DEFAULT_CHARACTER_ID,
		createdAt: new Date(turn.createdAt)
	};

	const id = await db.conversationTurns.add(dbTurn);
	return id as number;
}

export async function deleteAllTurns(): Promise<void> {
	await db.conversationTurns.clear();
}

export async function deleteTurnsForSession(sessionId: number): Promise<void> {
	await db.conversationTurns.where('sessionId').equals(sessionId).delete();
}

// Fact Library

export async function getFactLibraryEntries(
	options: FactLibrarySearchOptions = {}
): Promise<FactLibraryEntry[]> {
	let entries = await db.factLibrary.toArray();

	// Filter by characterId
	if (options.characterId) {
		entries = entries.filter((e) => e.characterId === options.characterId);
	}

	// Filter by type
	if (options.type) {
		entries = entries.filter((e) => e.type === options.type);
	}

	// Filter by category
	if (options.category) {
		entries = entries.filter((e) => e.category === options.category);
	}

	// Filter by minimum confidence
	if (options.minConfidence !== undefined) {
		entries = entries.filter((e) => e.confidence >= options.minConfidence!);
	}

	// Filter by keywords
	if (options.keywords && options.keywords.length > 0) {
		const lowerKeywords = options.keywords.map((k) => k.toLowerCase());
		entries = entries.filter((e) =>
			lowerKeywords.some(
				(kw) =>
					e.key.toLowerCase().includes(kw) ||
					e.value.toLowerCase().includes(kw) ||
					e.tags?.some((t) => t.toLowerCase().includes(kw))
			)
		);
	}

	// Sort by confidence ascending (lowest first = needs review), then by reviewCount
	entries.sort((a, b) => {
		if (a.confidence !== b.confidence) return a.confidence - b.confidence;
		return a.reviewCount - b.reviewCount;
	});

	if (options.limit) {
		entries = entries.slice(0, options.limit);
	}

	return entries.map(deserializeFactLibraryEntry);
}

export async function getFactLibraryEntryByKey(
	key: string,
	type: string,
	characterId: string = DEFAULT_CHARACTER_ID
): Promise<FactLibraryEntry | undefined> {
	const entry = await db.factLibrary
		.where({ characterId, type, key })
		.first();
	return entry ? deserializeFactLibraryEntry(entry) : undefined;
}

export async function saveFactLibraryEntry(
	entry: Omit<FactLibraryEntry, 'id' | 'createdAt' | 'reviewCount'> & {
		characterId?: string;
	}
): Promise<number> {
	const now = new Date();

	// Generate embedding if model is ready
	let embedding: number[] | undefined;
	if (isEmbeddingReady()) {
		const textToEmbed = `${entry.key} ${entry.value} ${entry.category ?? ''} ${entry.tags?.join(' ') ?? ''}`;
		const result = await embedText(textToEmbed);
		if (result) embedding = result;
	}

	const dbEntry: Omit<DBFactLibraryEntry, 'id'> = {
		characterId: entry.characterId ?? DEFAULT_CHARACTER_ID,
		type: entry.type,
		key: entry.key,
		value: entry.value,
		category: entry.category,
		tags: entry.tags,
		difficulty: entry.difficulty,
		confidence: entry.confidence,
		createdAt: now,
		lastReviewedAt: now,
		reviewCount: 0,
		embedding,
		metadata: entry.metadata
	};

	const id = await db.factLibrary.add(dbEntry);
	return id as number;
}

export async function updateFactLibraryEntry(
	id: number,
	updates: Partial<Omit<FactLibraryEntry, 'id' | 'createdAt'>>
): Promise<void> {
	const serialized: Partial<DBFactLibraryEntry> = { ...updates };
	if (updates.lastReviewedAt) serialized.lastReviewedAt = new Date(updates.lastReviewedAt);
	await db.factLibrary.update(id, serialized);
}

export async function incrementFactLibraryReview(
	id: number,
	confidenceDelta: number = 0.15
): Promise<void> {
	const entry = await db.factLibrary.get(id);
	if (!entry) return;
	await db.factLibrary.update(id, {
		reviewCount: entry.reviewCount + 1,
		lastReviewedAt: new Date(),
		confidence: Math.min(1, Math.max(0, entry.confidence + confidenceDelta))
	});
}

export async function deleteFactLibraryEntry(id: number): Promise<void> {
	await db.factLibrary.delete(id);
}

export async function getFactLibraryEntriesWithoutEmbeddings(): Promise<FactLibraryEntry[]> {
	const entries = await db.factLibrary.toArray();
	return entries
		.filter((e) => !e.embedding || e.embedding.length === 0)
		.map(deserializeFactLibraryEntry);
}

export async function getAllFactLibraryEntriesWithEmbeddings(): Promise<FactLibraryEntry[]> {
	const entries = await db.factLibrary.toArray();
	return entries.map(deserializeFactLibraryEntry);
}

export async function updateFactLibraryEmbedding(
	id: number,
	embedding: number[]
): Promise<void> {
	await db.factLibrary.update(id, { embedding });
}

// Serialization helpers

function deserializeFact(fact: DBFact): Fact {
	return {
		...fact,
		createdAt: new Date(fact.createdAt),
		lastAccessed: fact.lastAccessed ? new Date(fact.lastAccessed) : undefined
	};
}

function deserializeSession(session: DBSessionSummary): SessionSummary {
	return {
		...session,
		startedAt: new Date(session.startedAt),
		endedAt: session.endedAt ? new Date(session.endedAt) : undefined
	};
}

function deserializeTurn(turn: DBConversationTurn): ConversationTurn {
	return {
		...turn,
		createdAt: new Date(turn.createdAt)
	};
}

function deserializeFactLibraryEntry(entry: DBFactLibraryEntry): FactLibraryEntry {
	return {
		...entry,
		createdAt: new Date(entry.createdAt),
		lastReviewedAt: entry.lastReviewedAt ? new Date(entry.lastReviewedAt) : undefined
	};
}

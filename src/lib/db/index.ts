import Dexie, { type EntityTable } from 'dexie';
import type { CharacterState } from '$lib/types/character';
import type { Fact, SessionSummary, ConversationTurn, FactLibraryEntry, Reminder } from '$lib/types/memory';
import type { VocabularyEntry } from '$lib/types/vocabulary';
import type { CompletedEventRecord } from '$lib/types/events';

// Database types with IndexedDB-friendly id handling
export interface DBCharacterState extends Omit<CharacterState, 'id'> {
	id?: number;
}

export interface DBFact extends Omit<Fact, 'id'> {
	id?: number;
}

export interface DBSessionSummary extends Omit<SessionSummary, 'id'> {
	id?: number;
}

export interface DBConversationTurn extends Omit<ConversationTurn, 'id'> {
	id?: number;
}

export interface DBCompletedEvent extends Omit<CompletedEventRecord, 'id'> {
	id?: number;
}

export interface DBFactLibraryEntry extends Omit<FactLibraryEntry, 'id'> {
	id?: number;
}

export interface DBReminder extends Omit<Reminder, 'id'> {
	id?: number;
}

export interface DBVocabularyEntry extends Omit<VocabularyEntry, 'id'> {
	id?: number;
}

// Legacy persona storage keys (for migration)
const LEGACY_PERSONA_CARDS_KEY = 'utsuwa-persona-cards';
const LEGACY_PERSONA_ACTIVE_KEY = 'utsuwa-persona-active-id';

class UtsuwaDatabase extends Dexie {
	characterStates!: EntityTable<DBCharacterState, 'id'>;
	facts!: EntityTable<DBFact, 'id'>;
	sessions!: EntityTable<DBSessionSummary, 'id'>;
	conversationTurns!: EntityTable<DBConversationTurn, 'id'>;
	completedEvents!: EntityTable<DBCompletedEvent, 'id'>;
	factLibrary!: EntityTable<DBFactLibraryEntry, 'id'>;
	reminders!: EntityTable<DBReminder, 'id'>;
	vocabulary!: EntityTable<DBVocabularyEntry, 'id'>;

	constructor() {
		super('utsuwa-db');

		// Version 1: Original multi-persona schema (legacy)
		this.version(1).stores({
			characterStates: '++id, &personaId, updatedAt',
			companion: '++id, &personaId',
			facts: '++id, personaId, category, importance, createdAt',
			sessions: '++id, personaId, startedAt',
			conversationTurns: '++id, personaId, sessionId, createdAt',
			completedEvents: '++id, personaId, eventId, completedAt'
		});

		// Version 2: Single companion - remove personaId indexes, remove companion table
		this.version(2)
			.stores({
				characterStates: '++id, updatedAt',
				companion: null, // Delete the companion table
				facts: '++id, category, importance, createdAt',
				sessions: '++id, startedAt',
				conversationTurns: '++id, sessionId, createdAt',
				completedEvents: '++id, eventId, completedAt'
			})
			.upgrade(async (tx) => {
				// Migration: merge persona from localStorage with first characterState
				const characterStates = tx.table('characterStates');

				// Get the first character state (or the one for 'default' persona)
				const existingStates = await characterStates.toArray();
				const defaultState =
					existingStates.find((s: Record<string, unknown>) => s.personaId === 'default') ||
					existingStates[0];

				// Read persona from localStorage
				let personaName = 'Utsuwa';
				let personaPrompt =
					'You are a friendly AI assistant named Utsuwa. You communicate through a VRM avatar and can express emotions through facial expressions and gestures. Be helpful, conversational, and engaging.';
				let personaExtensions = {};

				if (typeof window !== 'undefined') {
					try {
						const savedCards = localStorage.getItem(LEGACY_PERSONA_CARDS_KEY);
						const savedActiveId = localStorage.getItem(LEGACY_PERSONA_ACTIVE_KEY);
						if (savedCards) {
							const cards = JSON.parse(savedCards);
							// Get active or default persona
							const activeCard = cards[savedActiveId || 'default'] || cards['default'];
							if (activeCard) {
								personaName = activeCard.name || personaName;
								personaPrompt = activeCard.systemPrompt || personaPrompt;
								personaExtensions = activeCard.extensions || {};
							}
						}
						// Clean up legacy localStorage
						localStorage.removeItem(LEGACY_PERSONA_CARDS_KEY);
						localStorage.removeItem(LEGACY_PERSONA_ACTIVE_KEY);
					} catch {
						// Ignore localStorage errors during migration
					}
				}

				// Clear all character states
				await characterStates.clear();

				// Create unified state with persona fields
				if (defaultState) {
					const { personaId: _personaId, ...rest } = defaultState as Record<string, unknown>;
					await characterStates.add({
						...rest,
						name: personaName,
						systemPrompt: personaPrompt,
						extensions: personaExtensions,
						updatedAt: new Date()
					} as DBCharacterState);
				}
			});

		// Version 3: Add embedding field to facts for semantic search
		// No migration needed - embedding field is optional and will be backfilled lazily
		this.version(3).stores({
			characterStates: '++id, updatedAt',
			facts: '++id, category, importance, createdAt',
			sessions: '++id, startedAt',
			conversationTurns: '++id, sessionId, createdAt',
			completedEvents: '++id, eventId, completedAt'
		});

		// Version 4: characterId tagging, factLibrary table, soulPrompt
		this.version(4)
			.stores({
				characterStates: '++id, updatedAt',
				facts: '++id, characterId, category, importance, createdAt',
				sessions: '++id, characterId, startedAt',
				conversationTurns: '++id, characterId, sessionId, createdAt',
				completedEvents: '++id, characterId, eventId, completedAt',
				factLibrary: '++id, characterId, type, category, confidence, createdAt'
			})
			.upgrade(async (tx) => {
				// Migrate existing data: assign default characterId
				const facts = tx.table('facts');
				const sessions = tx.table('sessions');
				const conversationTurns = tx.table('conversationTurns');
				const completedEvents = tx.table('completedEvents');
				const characterStates = tx.table('characterStates');

				// Assign default characterId to all existing records
				await facts.toCollection().modify((f: Record<string, unknown>) => {
					f.characterId = 'default';
				});
				await sessions.toCollection().modify((s: Record<string, unknown>) => {
					s.characterId = 'default';
				});
				await conversationTurns.toCollection().modify((t: Record<string, unknown>) => {
					t.characterId = 'default';
				});
				await completedEvents.toCollection().modify((e: Record<string, unknown>) => {
					e.characterId = 'default';
				});

				// Migrate characterStates: copy systemPrompt to soulPrompt, add evolution fields
				await characterStates.toCollection().modify((cs: Record<string, unknown>) => {
					if (!cs.soulPrompt && cs.systemPrompt) {
						cs.soulPrompt = cs.systemPrompt;
					}
					if (!cs.sessionCountSinceEvolution) {
						cs.sessionCountSinceEvolution = 0;
					}
					if (!cs.evolutionThreshold) {
						cs.evolutionThreshold = 10;
					}
					const personality = cs.personality as Record<string, unknown> | undefined;
					if (personality && !Array.isArray(personality.communicationAdaptations)) {
						personality.communicationAdaptations = [];
					}
				});
			});

		// Version 5: Add reminders table
		this.version(5).stores({
			characterStates: '++id, updatedAt',
			facts: '++id, characterId, category, importance, createdAt',
			sessions: '++id, characterId, startedAt',
			conversationTurns: '++id, characterId, sessionId, createdAt',
			completedEvents: '++id, characterId, eventId, completedAt',
			factLibrary: '++id, characterId, type, category, confidence, createdAt',
			reminders: '++id, sessionId, triggerAt, executed'
		});

		// Version 6: Add vocabulary table (separate from factLibrary)
		this.version(6).stores({
			characterStates: '++id, updatedAt',
			facts: '++id, characterId, category, importance, createdAt',
			sessions: '++id, characterId, startedAt',
			conversationTurns: '++id, characterId, sessionId, createdAt',
			completedEvents: '++id, characterId, eventId, completedAt',
			factLibrary: '++id, characterId, type, category, confidence, createdAt',
			reminders: '++id, sessionId, triggerAt, executed',
			vocabulary: '++id, sourceWord, targetWord, category, level, familiarity, characterId, createdAt'
		});

		// Version 7: Multi-character isolation - add characterId to characterStates and migrate all existing data
		this.version(7)
			.stores({
				characterStates: '++id, characterId, updatedAt',
				facts: '++id, characterId, category, importance, createdAt',
				sessions: '++id, characterId, startedAt',
				conversationTurns: '++id, characterId, sessionId, createdAt',
				completedEvents: '++id, characterId, eventId, completedAt',
				factLibrary: '++id, characterId, type, category, confidence, createdAt',
				reminders: '++id, sessionId, triggerAt, executed',
				vocabulary: '++id, sourceWord, targetWord, category, level, familiarity, characterId, createdAt'
			})
			.upgrade(async (tx) => {
				const characterStates = tx.table('characterStates');
				const facts = tx.table('facts');
				const sessions = tx.table('sessions');
				const conversationTurns = tx.table('conversationTurns');
				const factLibrary = tx.table('factLibrary');

				await characterStates.toCollection().modify((cs: Record<string, unknown>) => {
					if (!cs.characterId) cs.characterId = 'default';
				});
				await facts.toCollection().modify((f: Record<string, unknown>) => {
					if (!f.characterId) f.characterId = 'default';
				});
				await sessions.toCollection().modify((s: Record<string, unknown>) => {
					if (!s.characterId) s.characterId = 'default';
				});
				await conversationTurns.toCollection().modify((t: Record<string, unknown>) => {
					if (!t.characterId) t.characterId = 'default';
				});
				await factLibrary.toCollection().modify((e: Record<string, unknown>) => {
					if (!e.characterId) e.characterId = 'default';
				});
			});
	}
}

export const db = new UtsuwaDatabase();

// Helper to check if we're in a browser environment with IndexedDB support
export function isIndexedDBAvailable(): boolean {
	return typeof window !== 'undefined' && 'indexedDB' in window;
}

import { db, type DBCharacterState } from '$lib/db';
import { createDefaultCharacterState, type CharacterState } from '$lib/types/character';

/**
 * Get a character state from IndexedDB by characterId.
 * Returns the matching record, or creates a default if none exists.
 */
export async function getCharacterState(characterId: string = 'default'): Promise<CharacterState> {
	const state = await db.characterStates.where('characterId').equals(characterId).first();

	if (state) {
		return deserializeCharacterState(state);
	}

	// Return default state (not saved until explicitly saved)
	const defaultState = createDefaultCharacterState() as CharacterState;
	defaultState.characterId = characterId;
	return defaultState;
}

/**
 * Save the character state to IndexedDB.
 * Upserts by characterId (multi-character model).
 */
export async function saveCharacterState(state: CharacterState): Promise<number> {
	const serialized = serializeCharacterState(state);

	// Ensure characterId is set
	const characterId = state.characterId ?? 'default';

	// Check if a record exists for this characterId
	const existing = await db.characterStates.where('characterId').equals(characterId).first();

	if (existing && existing.id !== undefined) {
		// Update existing record
		await db.characterStates.put({ ...serialized, id: existing.id });
		return existing.id;
	}

	// Create new record
	const id = await db.characterStates.add(serialized);
	return id as number;
}

/**
 * Delete character state data for a specific characterId (used for reset).
 * If no characterId is provided, deletes all character states.
 */
export async function deleteCharacterState(characterId?: string): Promise<void> {
	if (characterId) {
		const existing = await db.characterStates.where('characterId').equals(characterId).first();
		if (existing && existing.id !== undefined) {
			await db.characterStates.delete(existing.id);
		}
	} else {
		await db.characterStates.clear();
	}
}

// Serialize dates for storage
function serializeCharacterState(state: CharacterState): Omit<DBCharacterState, 'id'> {
	return {
		...state,
		lastInteraction: state.lastInteraction ? new Date(state.lastInteraction) : null,
		lastDecayAt: state.lastDecayAt ? new Date(state.lastDecayAt) : null,
		firstMet: new Date(state.firstMet),
		createdAt: new Date(state.createdAt),
		updatedAt: new Date()
	};
}

// Deserialize dates from storage
function deserializeCharacterState(state: DBCharacterState): CharacterState {
	return {
		...state,
		lastInteraction: state.lastInteraction ? new Date(state.lastInteraction) : null,
		lastDecayAt: state.lastDecayAt ? new Date(state.lastDecayAt) : null,
		firstMet: new Date(state.firstMet),
		createdAt: new Date(state.createdAt),
		updatedAt: new Date(state.updatedAt)
	} as CharacterState;
}

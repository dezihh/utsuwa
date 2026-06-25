import { db } from '$lib/db';
import type { VocabularyEntry, VocabQuery } from '$lib/types/vocabulary';

const DEFAULT_CHARACTER_ID = 'default';

export async function saveVocabularyEntry(
	entry: Omit<VocabularyEntry, 'id' | 'createdAt' | 'familiarity'>
): Promise<number> {
	const dbEntry = {
		...entry,
		familiarity: 0.0,
		createdAt: new Date()
	};
	const id = await db.vocabulary.add(dbEntry);
	return id as number;
}

export async function saveVocabularyEntries(
	entries: Omit<VocabularyEntry, 'id' | 'createdAt' | 'familiarity'>[]
): Promise<number> {
	const dbEntries = entries.map((e) => ({
		...e,
		familiarity: 0.0,
		createdAt: new Date()
	}));
	const ids = await db.vocabulary.bulkAdd(dbEntries);
	return Array.isArray(ids) ? ids.length : 1;
}

export async function getVocabularyEntries(
	query: VocabQuery & { characterId: string }
): Promise<VocabularyEntry[]> {
	let entries = await db.vocabulary
		.where('characterId')
		.equals(query.characterId)
		.toArray();

	switch (query.mode) {
		case 'category':
			if (query.filter) {
				entries = entries.filter((e) => e.category === query.filter);
			}
			entries.sort((a, b) => a.familiarity - b.familiarity);
			break;

		case 'level':
			if (query.filter) {
				entries = entries.filter((e) => e.level === query.filter);
			}
			entries.sort(() => Math.random() - 0.5);
			break;

		case 'review':
			entries.sort((a, b) => {
				const famDiff = a.familiarity - b.familiarity;
				if (famDiff !== 0) return famDiff;
				const aDate = a.lastReviewed ? new Date(a.lastReviewed).getTime() : 0;
				const bDate = b.lastReviewed ? new Date(b.lastReviewed).getTime() : 0;
				return aDate - bDate;
			});
			break;

		case 'new':
			entries = entries.filter((e) => e.familiarity < 0.3);
			entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
			break;

		case 'random':
			entries.sort(() => Math.random() - 0.5);
			break;
	}

	return entries.slice(0, query.count).map(deserializeVocabularyEntry);
}

export async function updateVocabularyFamiliarity(
	id: number,
	familiarity: number
): Promise<void> {
	await db.vocabulary.update(id, {
		familiarity: Math.max(0, Math.min(1, familiarity)),
		lastReviewed: new Date()
	});
}

export async function deleteAllVocabulary(characterId?: string): Promise<void> {
	if (characterId) {
		await db.vocabulary.where('characterId').equals(characterId).delete();
	} else {
		await db.vocabulary.clear();
	}
}

export async function getVocabularyStats(
	characterId: string = DEFAULT_CHARACTER_ID
): Promise<{ total: number; known: number; learning: number }> {
	const entries = await db.vocabulary.where('characterId').equals(characterId).toArray();
	const total = entries.length;
	const known = entries.filter((e) => e.familiarity >= 0.8).length;
	const learning = entries.filter((e) => e.familiarity > 0.3 && e.familiarity < 0.8).length;
	return { total, known, learning };
}

export async function getVocabularyMeta(
	characterId: string = DEFAULT_CHARACTER_ID
): Promise<{
	total: number;
	categories: string[];
	levels: string[];
	sourceLang: string | undefined;
	targetLang: string | undefined;
}> {
	const entries = await db.vocabulary.where('characterId').equals(characterId).toArray();
	const categories = [...new Set(entries.map((e) => e.category).filter(Boolean))].sort();
	const levels = [...new Set(entries.map((e) => e.level).filter(Boolean))].sort();
	const first = entries[0];
	return {
		total: entries.length,
		categories,
		levels,
		sourceLang: first?.sourceLang,
		targetLang: first?.targetLang
	};
}

function deserializeVocabularyEntry(entry: VocabularyEntry): VocabularyEntry {
	return {
		...entry,
		createdAt: new Date(entry.createdAt),
		lastReviewed: entry.lastReviewed ? new Date(entry.lastReviewed) : undefined
	};
}

export interface VocabularyEntry {
	id?: number;
	sourceLang: string; // e.g. "de"
	targetLang: string; // e.g. "es"
	sourceWord: string; // e.g. "Haus"
	targetWord: string; // e.g. "casa"
	context?: string; // e.g. "Mi casa es grande"
	category: string; // e.g. "Wohnen", "Tiere"
	level: string; // e.g. "A1", "A2", "B1"
	tags: string[]; // e.g. ["noun", "alltag"]
	familiarity: number; // 0.0 – 1.0 (how well user knows it)
	lastReviewed?: Date;
	characterId: string;
	createdAt: Date;
}

export interface VocabQuery {
	mode: 'category' | 'level' | 'review' | 'new' | 'random';
	filter?: string; // category name or level
	count: number; // how many to fetch
}

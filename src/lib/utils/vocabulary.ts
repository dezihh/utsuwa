import type { VocabQuery } from '$lib/types/vocabulary';

export interface ParsedVocabTag {
	mode: 'category' | 'level' | 'review' | 'new' | 'random';
	filter?: string;
	count: number;
}

export function extractVocabTags(text: string): { tags: ParsedVocabTag[]; cleanedText: string } {
	const regex = /\[vocab:([^\]]+)\]/g;
	const tags: ParsedVocabTag[] = [];
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		const parsed = parseVocabTag(match[0]);
		if (parsed) tags.push(parsed);
	}

	const cleanedText = text.replace(regex, '');
	return { tags, cleanedText };
}

export function parseVocabTag(tag: string): ParsedVocabTag | null {
	// Use [^\]:]+ instead of \w+ to support Unicode characters (Umlaute, accents, etc.)
	const match = tag.match(/^\[vocab:([^\]:]+)(?::([^\]]*))?:(\d+)\]$/);
	if (!match) return null;

	const mode = match[1].trim() as ParsedVocabTag['mode'];
	if (!['category', 'level', 'review', 'new', 'random'].includes(mode)) return null;

	const filter = match[2]?.trim() || undefined;
	const count = parseInt(match[3], 10);
	if (isNaN(count) || count <= 0) return null;

	return { mode, filter, count };
}

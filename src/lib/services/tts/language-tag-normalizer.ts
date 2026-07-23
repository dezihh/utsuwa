import type { ToolCall } from './speech-compiler.ts';

export interface NormalizedLanguageOutput {
	/** Tool calls extracted from language/gesture markers. */
	calls: ToolCall[];
	/** Visible text with all control markers removed. */
	cleanedText: string;
}

interface TagMatch {
	index: number;
	end: number;
	language?: string;
	text?: string;
	gestureType?: string;
	type: 'speak' | 'gesture';
}

const SPEAK_BRACKET_RE = /\[lang:([a-zA-Z\-]{2,8})\]([\s\S]*?)\[\/lang\]/g;
const SPEAK_ANGLE_COLON_RE = /<speak:([a-zA-Z\-]{2,8})>([\s\S]*?)<\/speak>/g;
const SPEAK_ANGLE_EQUALS_RE = /<lang=([a-zA-Z\-]{2,8})>([\s\S]*?)<\/lang>/g;
const SPEAK_ANGLE_CODE_RE = /<lang\s+code=["']([a-zA-Z\-]{2,8})["']>([\s\S]*?)<\/lang>/g;
const GESTURE_ANGLE_COLON_RE = /<gesture:([a-zA-Z\-]+)>/g;
const GESTURE_BRACKET_RE = /\[gesture:([a-zA-Z\-]+)\]/g;

function collectTagMatches(text: string): TagMatch[] {
	const matches: TagMatch[] = [];

	for (const m of text.matchAll(SPEAK_BRACKET_RE)) {
		matches.push({
			index: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			language: m[1],
			text: m[2].trim(),
			type: 'speak'
		});
	}

	for (const m of text.matchAll(SPEAK_ANGLE_COLON_RE)) {
		matches.push({
			index: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			language: m[1],
			text: m[2].trim(),
			type: 'speak'
		});
	}

	for (const m of text.matchAll(SPEAK_ANGLE_EQUALS_RE)) {
		matches.push({
			index: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			language: m[1],
			text: m[2].trim(),
			type: 'speak'
		});
	}

	for (const m of text.matchAll(SPEAK_ANGLE_CODE_RE)) {
		matches.push({
			index: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			language: m[1],
			text: m[2].trim(),
			type: 'speak'
		});
	}

	for (const m of text.matchAll(GESTURE_ANGLE_COLON_RE)) {
		matches.push({
			index: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			gestureType: m[1],
			type: 'gesture'
		});
	}

	for (const m of text.matchAll(GESTURE_BRACKET_RE)) {
		matches.push({
			index: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			gestureType: m[1],
			type: 'gesture'
		});
	}

	return matches.sort((a, b) => a.index - b.index);
}

/**
 * Convert common LLM language/gesture markup into speak()/gesture() tool calls
 * and return a cleaned visible text without any control markers.
 *
 * Handles:
 *   [lang:es]text[/lang]
 *   <speak:es>text</speak>
 *   <lang=es>text</lang>
 *   <lang code="es">text</lang>
 *   <gesture:smile>  and  [gesture:smile]
 */
export function normalizeLanguageTags(text: string, primaryLanguage: string): NormalizedLanguageOutput {
	const calls: ToolCall[] = [];
	const cleanedParts: string[] = [];

	const matches = collectTagMatches(text);

	let lastIndex = 0;
	for (const match of matches) {
		const before = text.slice(lastIndex, match.index).trim();
		if (before) {
			cleanedParts.push(before);
			calls.push({ name: 'speak', arguments: { text: before, lang: primaryLanguage } });
		}

		if (match.type === 'speak' && match.text) {
			cleanedParts.push(match.text);
			calls.push({
				name: 'speak',
				arguments: { text: match.text, lang: match.language ?? primaryLanguage }
			});
		} else if (match.type === 'gesture' && match.gestureType) {
			calls.push({ name: 'gesture', arguments: { type: match.gestureType } });
		}

		lastIndex = match.end;
	}

	const after = text.slice(lastIndex).trim();
	if (after) {
		cleanedParts.push(after);
		calls.push({ name: 'speak', arguments: { text: after, lang: primaryLanguage } });
	}

	return {
		calls,
		cleanedText: cleanedParts.join(' ').trim()
	};
}

import type { SpeechSegment } from '$lib/services/voice-orchestrator';

/**
 * Emotion/sound tags the LLM can embed in its output.
 * Each entry defines:
 *   - ttsText:      what gets sent to the TTS engine (spoken aloud)
 *   - exaggeration: optional Chatterbox expressiveness override (0–1)
 *   - displayText:  replacement shown in the chat bubble ('' = invisible)
 */
const EMOTION_TAGS: Record<
	string,
	{ ttsText: string; exaggeration?: number; displayText?: string }
> = {
	laugh:    { ttsText: 'Hahaha,',   exaggeration: 0.9,  displayText: '😄' },
	giggle:   { ttsText: 'Hehehe,',   exaggeration: 0.85, displayText: '🙈' },
	chuckle:  { ttsText: 'Hm, haha,', exaggeration: 0.75, displayText: '😏' },
	sigh:     { ttsText: 'Hmm...',     exaggeration: 0.3,  displayText: '😮‍💨' },
	excited:  { ttsText: '',           exaggeration: 0.95 },
	sad:      { ttsText: '',           exaggeration: 0.6  },
	calm:     { ttsText: '',           exaggeration: 0.2  },
	whisper:  { ttsText: '',           exaggeration: 0.15 },
	dramatic: { ttsText: '',           exaggeration: 1.0  },
};

const EMOTION_TAG_REGEX = /\[(\w+)\]/g;

/**
 * Splits text into sentences for sentence-by-sentence TTS pipelining.
 * Splits on .!? followed by whitespace + capital letter to avoid
 * splitting abbreviations (Dr. Smith) or decimal numbers (3.5).
 */
export function splitIntoSentences(text: string): string[] {
	if (!text.trim()) return [];

	const parts = text
		.split(/(?<=[.!?…])\s+(?=[A-ZÄÖÜ0-9"„«])/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	return parts.length > 0 ? parts : [text.trim()];
}

/**
 * Strip [lang:xx] markers from text for display purposes.
 */
export function stripLangTags(text: string): string {
	return text.replace(/\[lang:[a-z]{2,3}\]/gi, '').replace(/  +/g, ' ').trim();
}

/**
 * Replace [emotion] tags with their display representation for chat bubbles.
 * Known tags → emoji/symbol; unknown [word] tags → removed.
 */
export function replaceEmotionTagsForDisplay(text: string): string {
	return text
		.replace(EMOTION_TAG_REGEX, (_match, tag) => {
			const key = tag.toLowerCase();
			const entry = EMOTION_TAGS[key];
			if (!entry) return ''; // unknown tag → remove
			return entry.displayText ?? '';
		})
		.replace(/  +/g, ' ')
		.trim();
}

/**
 * Strip all control tags ([lang:xx] and [emotion]) for display.
 */
export function stripAllTags(text: string): string {
	return replaceEmotionTagsForDisplay(stripLangTags(text));
}

/**
 * Split text into SpeechSegments, honouring [lang:xx] section markers and
 * [emotion] inline tags.
 *
 * - [lang:xx] applies to all following sentences until the next lang marker.
 * - [emotion] tags within a sentence set exaggeration for that segment and
 *   prepend the ttsText (e.g. "Hahaha,") before the sentence text.
 *
 * Example LLM output:
 *   "Heute üben wir Farben. [lang:es]Rojo, verde. [lang:de][laugh]Das war super!"
 */
export function splitIntoSegments(text: string, defaultLanguage?: string): SpeechSegment[] {
	if (!text.trim()) return [];

	// Split by [lang:xx] markers; capturing group yields alternating text/langCode
	const langTagRegex = /\[lang:([a-z]{2,3})\]/gi;
	const parts = text.split(langTagRegex);

	const segments: SpeechSegment[] = [];
	let currentLang: string | undefined = defaultLanguage || undefined;

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			currentLang = parts[i].toLowerCase();
		} else {
			const section = parts[i];
			if (!section.trim()) continue;
			for (const sentence of splitIntoSentences(section)) {
				segments.push(...extractEmotionSegments(sentence, currentLang));
			}
		}
	}

	return segments.length > 0 ? segments : [{ text: text.trim(), language: defaultLanguage }];
}

/**
 * Extract emotion tags from a single sentence and return one or more segments.
 * A sentence can contain multiple [emotion] tags; each tag starts a new segment
 * so exaggeration can vary within a single sentence run.
 */
function extractEmotionSegments(sentence: string, language?: string): SpeechSegment[] {
	// Reset regex state
	EMOTION_TAG_REGEX.lastIndex = 0;

	// Collect all [emotion] tag positions
	const matches: { tag: string; index: number; length: number }[] = [];
	let m: RegExpExecArray | null;
	const re = /\[(\w+)\]/g;
	while ((m = re.exec(sentence)) !== null) {
		const key = m[1].toLowerCase();
		if (EMOTION_TAGS[key]) {
			matches.push({ tag: key, index: m.index, length: m[0].length });
		}
	}

	if (matches.length === 0) {
		// No emotion tags – plain segment
		return [{ text: sentence.trim(), language }];
	}

	const result: SpeechSegment[] = [];
	let cursor = 0;
	let currentExaggeration: number | undefined = undefined;

	for (const match of matches) {
		// Text before this tag
		const before = sentence.slice(cursor, match.index).trim();
		if (before) {
			const seg: SpeechSegment = { text: before, language };
			if (currentExaggeration !== undefined) seg.exaggeration = currentExaggeration;
			result.push(seg);
		}

		const entry = EMOTION_TAGS[match.tag];
		currentExaggeration = entry.exaggeration;

		// If the tag has its own spoken text (e.g. "Hahaha,"), emit it as its own segment
		if (entry.ttsText) {
			const seg: SpeechSegment = { text: entry.ttsText, language };
			if (entry.exaggeration !== undefined) seg.exaggeration = entry.exaggeration;
			result.push(seg);
		}

		cursor = match.index + match.length;
	}

	// Remaining text after last tag
	const remaining = sentence.slice(cursor).trim();
	if (remaining) {
		const seg: SpeechSegment = { text: remaining, language };
		if (currentExaggeration !== undefined) seg.exaggeration = currentExaggeration;
		result.push(seg);
	}

	return result.filter((s) => s.text.length > 0);
}

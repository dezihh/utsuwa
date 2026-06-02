import type { SpeechSegment } from '$lib/services/voice-orchestrator';

/**
 * Emotion/sound tags the LLM can embed in its output.
 * Each entry defines:
 *   - ttsText:       what gets sent to the TTS engine (spoken aloud)
 *   - exaggeration:  optional Chatterbox expressiveness override (0-1)
 *   - displayText:   replacement shown in the chat bubble ('' = invisible)
 *   - vrmExpression: semantic expression hint for VRM mapping
 */
const EMOTION_TAGS: Record<
	string,
	{ ttsText: string; exaggeration?: number; displayText?: string; vrmExpression?: string }
> = {
	laugh: { ttsText: 'Hahaha,', exaggeration: 0.9, displayText: '😄', vrmExpression: 'happy' },
	giggle: { ttsText: 'Hehehe,', exaggeration: 0.85, displayText: '🙈', vrmExpression: 'happy' },
	chuckle: { ttsText: 'Hm, haha,', exaggeration: 0.75, displayText: '😏', vrmExpression: 'happy' },
	sigh: { ttsText: 'Hmm...', exaggeration: 0.3, displayText: '😮‍💨', vrmExpression: 'sad' },
	excited: { ttsText: '', exaggeration: 0.95, vrmExpression: 'happy' },
	sad: { ttsText: '', exaggeration: 0.6, vrmExpression: 'sad' },
	calm: { ttsText: '', exaggeration: 0.2, vrmExpression: 'relaxed' },
	whisper: { ttsText: '', exaggeration: 0.15, vrmExpression: 'relaxed' },
	dramatic: { ttsText: '', exaggeration: 1.0, vrmExpression: 'surprised' }
};

/**
 * Known action tags the LLM can embed in responses.
 * These trigger optional VRM body animations.
 */
const ACTION_TAGS = new Set(['wave', 'nod', 'shake', 'jump', 'bow', 'think', 'clap', 'dance']);

const EMOTION_TAG_REGEX = /\[(\w+)\]/g;
const ACTION_TAG_REGEX = /\[action:(\w+)\]/gi;

export function getEmotionVrmExpression(emotionTag: string): string | null {
	const entry = EMOTION_TAGS[emotionTag.toLowerCase()];
	return entry?.vrmExpression ?? null;
}

export function getKnownEmotionTags(): string[] {
	return Object.keys(EMOTION_TAGS);
}

export function getKnownActionTags(): string[] {
	return [...ACTION_TAGS];
}

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
			if (!entry) return '';
			return entry.displayText ?? '';
		})
		.replace(/  +/g, ' ')
		.trim();
}

/**
 * Strip [action:xxx] tags from text for display.
 */
export function stripActionTags(text: string): string {
	return text.replace(ACTION_TAG_REGEX, '').replace(/  +/g, ' ').trim();
}

/**
 * Strip all control tags ([lang:xx], [emotion], [action:xxx]) for display.
 */
export function stripAllTags(text: string): string {
	return replaceEmotionTagsForDisplay(stripActionTags(stripLangTags(text)));
}

/**
 * Split text into SpeechSegments, honouring [lang:xx] section markers,
 * [emotion] inline tags, and [action:xxx] triggers.
 *
 * @param text Raw LLM output
 * @param defaultLanguage Fallback language code
 * @param streaming If true (e.g. Chatterbox), skip sentence splitting within
 * language blocks to preserve full context.
 */
export function splitIntoSegments(
	text: string,
	defaultLanguage?: string,
	streaming = false
): SpeechSegment[] {
	if (!text.trim()) return [];

	let action: string | undefined;
	const actionMatch = ACTION_TAG_REGEX.exec(text);
	if (actionMatch && ACTION_TAGS.has(actionMatch[1].toLowerCase())) {
		action = actionMatch[1].toLowerCase();
	}
	ACTION_TAG_REGEX.lastIndex = 0;
	const cleanText = text.replace(ACTION_TAG_REGEX, '');

	const langTagRegex = /\[lang:([a-z]{2,3})\]/gi;
	const parts = cleanText.split(langTagRegex);

	const segments: SpeechSegment[] = [];
	let currentLang: string | undefined = defaultLanguage || undefined;

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			currentLang = parts[i].toLowerCase();
		} else {
			const section = parts[i];
			if (!section.trim()) continue;

			if (streaming) {
				segments.push(...extractEmotionBlock(section, currentLang));
			} else {
				for (const sentence of splitIntoSentences(section)) {
					segments.push(...extractEmotionSegments(sentence, currentLang));
				}
			}
		}
	}

	if (action && segments.length > 0) {
		segments[0] = { ...segments[0], action };
	}

	return segments.length > 0 ? segments : [{ text: text.trim(), language: defaultLanguage }];
}

/**
 * Streaming mode: keep each language block as one segment, while applying
 * emotion tags as metadata and optional ttsText prefixes.
 */
function extractEmotionBlock(block: string, language?: string): SpeechSegment[] {
	const re = /\[(\w+)\]/g;
	let m: RegExpExecArray | null;
	let lastExaggeration: number | undefined;
	let lastEmotion: string | undefined;
	const prependTexts: string[] = [];

	while ((m = re.exec(block)) !== null) {
		const key = m[1].toLowerCase();
		const entry = EMOTION_TAGS[key];
		if (entry) {
			lastExaggeration = entry.exaggeration;
			lastEmotion = key;
			if (entry.ttsText) prependTexts.push(entry.ttsText);
		}
	}

	let cleanText = block
		.replace(/\[(\w+)\]/g, (_match, tag) => (EMOTION_TAGS[tag.toLowerCase()] ? '' : _match))
		.replace(/  +/g, ' ')
		.trim();

	if (prependTexts.length > 0) {
		cleanText = `${prependTexts.join(' ')} ${cleanText}`.trim();
	}

	if (!cleanText) return [];

	const seg: SpeechSegment = { text: cleanText, language };
	if (lastExaggeration !== undefined) seg.exaggeration = lastExaggeration;
	if (lastEmotion) seg.emotion = lastEmotion;
	return [seg];
}

/**
 * Legacy mode: split within sentence by emotion tags so exaggeration can
 * vary across the sentence flow.
 */
function extractEmotionSegments(sentence: string, language?: string): SpeechSegment[] {
	EMOTION_TAG_REGEX.lastIndex = 0;

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
		return [{ text: sentence.trim(), language }];
	}

	const result: SpeechSegment[] = [];
	let cursor = 0;
	let currentExaggeration: number | undefined = undefined;
	let currentEmotion: string | undefined = undefined;

	for (const match of matches) {
		const before = sentence.slice(cursor, match.index).trim();
		if (before) {
			const seg: SpeechSegment = { text: before, language };
			if (currentExaggeration !== undefined) seg.exaggeration = currentExaggeration;
			if (currentEmotion) seg.emotion = currentEmotion;
			result.push(seg);
		}

		const entry = EMOTION_TAGS[match.tag];
		currentExaggeration = entry.exaggeration;
		currentEmotion = match.tag;

		if (entry.ttsText) {
			const seg: SpeechSegment = { text: entry.ttsText, language, emotion: match.tag };
			if (entry.exaggeration !== undefined) seg.exaggeration = entry.exaggeration;
			result.push(seg);
		}

		cursor = match.index + match.length;
	}

	const remaining = sentence.slice(cursor).trim();
	if (remaining) {
		const seg: SpeechSegment = { text: remaining, language };
		if (currentExaggeration !== undefined) seg.exaggeration = currentExaggeration;
		if (currentEmotion) seg.emotion = currentEmotion;
		result.push(seg);
	}

	return result.filter((s) => s.text.length > 0);
}

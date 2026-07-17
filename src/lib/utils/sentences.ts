import type { SpeechSegment } from '$lib/services/voice-orchestrator';

/**
 * Split text into sentence-like chunks using punctuation followed by whitespace
 * or end-of-string. Falls back to the whole trimmed text if no boundary is found.
 */
export function splitIntoSentences(text: string): string[] {
	if (!text.trim()) return [];
	const parts = text
		.split(/(?<=[.!?…])\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parts.length > 0 ? parts : [text.trim()];
}

/**
 * Remove JSON state-update blocks and other artifacts that should never be
 * spoken. Collapses multiple spaces but preserves leading/trailing whitespace
 * so it is safe to use while text is still being streamed.
 */
export function stripSpeechArtifacts(text: string): { cleaned: string; removed: string[] } {
	const removed: string[] = [];

	// Remove fenced JSON blocks
	let cleaned = text.replace(/```json\s*([\s\S]*?)\s*```/gi, (_match, content) => {
		removed.push('```json' + (content ? ' ' + content.slice(0, 200) : '') + '```');
		return '';
	});

	// Remove inline JSON state-update blocks with brace balancing.
	cleaned = stripStateUpdateBlocks(cleaned, removed);

	// Remove Markdown asterisks that TTS would read aloud.
	cleaned = cleaned.replace(/\*+/g, ' ');

	// Remove arrows and other symbols that TTS engines read aloud as text.
	cleaned = cleaned.replace(/[→←↑↓⇒⇐⇑⇓]/g, ' ');

	// Ensure a space after sentence/clause punctuation when followed by a letter.
	cleaned = cleaned.replace(/([.,;:!?])([a-zA-ZäöüÄÖÜß])/g, '$1 $2');

	// Collapse multiple spaces but keep leading/trailing whitespace for streaming.
	cleaned = cleaned.replace(/  +/g, ' ');

	return { cleaned, removed: removed.filter((r) => r.trim().length > 0) };
}

/**
 * Final cleanup of text for speech. Same as stripSpeechArtifacts but trims
 * leading/trailing whitespace for finished output.
 */
export function stripForSpeech(text: string): { cleaned: string; removed: string[] } {
	const result = stripSpeechArtifacts(text);
	return { cleaned: result.cleaned.trim(), removed: result.removed };
}

const STATE_UPDATE_KEYS = [
	'mood_change',
	'affection_delta',
	'trust_delta',
	'intimacy_delta',
	'comfort_delta',
	'respect_delta',
	'energy_delta',
	'new_memory',
	'triggered_event',
	'structured_fact_seen'
];

function stripStateUpdateBlocks(text: string, removed: string[]): string {
	const keyPattern = new RegExp(`"(?:${STATE_UPDATE_KEYS.join('|')})"`);
	let result = '';
	let i = 0;

	while (i < text.length) {
		const ch = text[i];
		if (ch !== '{') {
			result += ch;
			i++;
			continue;
		}

		const rest = text.slice(i);
		const keyMatch = keyPattern.exec(rest);
		if (!keyMatch || keyMatch.index > 200) {
			result += ch;
			i++;
			continue;
		}

		let depth = 1;
		let inString = false;
		let escape = false;
		let j = i + 1;
		for (; j < text.length && depth > 0; j++) {
			const c = text[j];
			if (escape) {
				escape = false;
				continue;
			}
			if (c === '\\') {
				escape = true;
				continue;
			}
			if (c === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (c === '{') depth++;
			else if (c === '}') depth--;
		}

		if (depth === 0) {
			const block = text.slice(i, j);
			removed.push(block.slice(0, 500));
			i = j;
		} else {
			result += ch;
			i++;
		}
	}

	return result;
}

/**
 * Normalize XML-style and bracket-style language tags to an internal
 * `[lang:xx]` / `[lang:default]` representation so downstream tokenization only
 * has to handle one syntax.
 */
export function normalizeLangTags(text: string): string {
	return (
		text
			// XML-style with attribute: <lang code="es"> or <lang code='es'>
			.replace(/<lang\s+code\s*=\s*["']?\s*(default|[a-z]{2,3})\s*["']?\s*>/gi, '[lang:$1]')
			// XML-style with equals: <lang=es>
			.replace(/<lang\s*=\s*(default|[a-z]{2,3})\s*>/gi, '[lang:$1]')
			// XML-style plain: <lang es>
			.replace(/<lang\s+(default|[a-z]{2,3})\s*>/gi, '[lang:$1]')
			// XML closing tag
			.replace(/<\/lang>/gi, '[lang:default]')
			// Legacy closing tags
			.replace(/\[\/lang\]/gi, '[lang:default]')
			.replace(/\[\/lang:[a-z]{2,3}\]/gi, '[lang:default]')
			// Bracket variants with spaces
			.replace(/\[lang\s*=\s*(default|[a-z]{2,3})\s*\]/gi, '[lang:$1]')
			.replace(/\[lang:\s*(default|[a-z]{2,3})\s*\]/gi, '[lang:$1]')
	);
}

/**
 * Strip language control tags from text. Used when the tags themselves should
 * not be visible (e.g. chat display) while preserving the surrounding content.
 */
export function stripLangTags(text: string): string {
	return normalizeLangTags(text)
		.replace(/\[lang:(?:default|[a-z]{2,3})\]/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Split text into speech segments. Parses `<lang=xx>...</lang>` (and legacy
 * bracket variants) so each segment carries the correct language for voice
 * switching.
 */
export function splitIntoSegments(
	text: string,
	defaultLanguage?: string
): SpeechSegment[] {
	if (!text.trim()) return [];

	const normalized = normalizeLangTags(text);
	const tagRegex = /\[lang:(default|[a-z]{2,3})\]/gi;

	const tokens: Array<{ type: 'text' | 'lang'; value: string }> = [];
	let lastIdx = 0;
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(normalized)) !== null) {
		if (match.index > lastIdx) {
			tokens.push({ type: 'text', value: normalized.slice(lastIdx, match.index) });
		}
		tokens.push({ type: 'lang', value: match[1].toLowerCase() });
		lastIdx = match.index + match[0].length;
	}
	if (lastIdx < normalized.length) {
		tokens.push({ type: 'text', value: normalized.slice(lastIdx) });
	}

	let currentLang: string | undefined = defaultLanguage;
	const segments: SpeechSegment[] = [];

	for (const token of tokens) {
		if (token.type === 'lang') {
			currentLang = token.value === 'default' ? defaultLanguage : token.value;
		} else {
			for (const sentence of splitIntoSentences(token.value)) {
				if (sentence.trim()) {
					segments.push({ text: sentence, language: currentLang });
				}
			}
		}
	}

	return segments;
}

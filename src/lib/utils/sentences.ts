import type { SpeechSegment } from '$lib/services/voice-orchestrator';

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
 * Split text into SpeechSegments, honouring [lang:xx] section markers.
 *
 * The LLM can switch language mid-response by inserting [lang:es], [lang:de] etc.
 * Each marker applies to all following sentences until the next marker.
 * Sections without a marker inherit defaultLanguage (or no language = auto-detect).
 *
 * Example LLM output:
 *   "Heute üben wir Farben. [lang:es]Rojo, verde, azul. ¿Cuál es tu color favorito?
 *    [lang:de]Sehr gut! Das sind die Grundfarben."
 */
export function splitIntoSegments(text: string, defaultLanguage?: string): SpeechSegment[] {
	if (!text.trim()) return [];

	// Split by [lang:xx] markers; capturing group yields alternating text/langCode
	const tagRegex = /\[lang:([a-z]{2,3})\]/gi;
	const parts = text.split(tagRegex);

	const segments: SpeechSegment[] = [];
	let currentLang: string | undefined = defaultLanguage || undefined;

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			// Odd indices are captured language codes from the regex
			currentLang = parts[i].toLowerCase();
		} else {
			const section = parts[i];
			if (!section.trim()) continue;
			for (const sentence of splitIntoSentences(section)) {
				const seg: SpeechSegment = { text: sentence };
				if (currentLang) seg.language = currentLang;
				segments.push(seg);
			}
		}
	}

	return segments.length > 0 ? segments : [{ text: text.trim(), language: defaultLanguage }];
}

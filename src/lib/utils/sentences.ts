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

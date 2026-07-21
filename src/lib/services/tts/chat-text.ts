import type { ToolCall } from './speech-compiler.ts';
import { parsePseudoToolCalls } from './speech-compiler.ts';
import { normalizeLanguageTags } from './language-tag-normalizer.ts';

/**
 * Remove OmniVoice speech/gesture control markers from visible chat text.
 * Keeps the spoken text itself (e.g. the Spanish words inside the tags).
 *
 * Handles both inline markup (`<speak:es>`, `[lang:es]`, `<gesture:smile>`)
 * and pseudo-tool-call syntax (`speak({...})`, `gesture({...})`).
 */
export function cleanSpeechMarkers(text: string, primaryLanguage = 'de'): string {
	// First normalise pseudo-tool-call syntax: speak() texts are inlined,
	// pause/gesture calls are dropped.
	const pseudo = parsePseudoToolCalls(text);
	const afterPseudo = pseudo.calls.length > 0 ? pseudo.cleanedText : text;

	// Then strip inline markup tags.
	const { cleanedText } = normalizeLanguageTags(afterPseudo, primaryLanguage);
	return cleanedText;
}

/**
 * Reconstruct visible chat text from speak() tool calls.
 * Used when the assistant message has only tool_calls and no text content.
 */
export function reconstructChatText(toolCalls: ToolCall[]): string {
	return toolCalls
		.filter((c) => c.name === 'speak')
		.map((c) => String(c.arguments.text ?? ''))
		.join(' ');
}
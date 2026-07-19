import type { ToolCall } from './speech-compiler.ts';

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
/**
 * Pure helpers for the client-side MCP tool loop: turning MCP tools into
 * OpenAI tool definitions, assembling the follow-up messages after a tool
 * round, and keeping the response assembly clean across rounds. Kept free of
 * browser/store dependencies so the loop logic is unit-testable.
 */
import type { McpCollectedToolCall, McpTool } from '$lib/types/mcp';
// Relative import (with extension) so this module stays loadable by the plain
// node test runner — same pattern as chat-text.ts.
import { STATE_FENCE_OPEN } from '../../ai/response-parser.ts';

/** Maximum tool rounds per companion turn (safety bound). */
export const MCP_MAX_ROUNDS = 5;

export interface OpenAiToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

// Type aliases (not interfaces) so the definitions stay assignable to the
// generic `Record<string, unknown>[]` tool parameter used by the chat clients.
export type OpenAiToolDefinition = {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
};

export interface LoopMessage {
	role: 'assistant' | 'tool' | 'user';
	content: string;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
}

export interface ToolResultEntry {
	call: McpCollectedToolCall;
	content: string;
	injectAsUser?: boolean;
}

/** OpenAI-shaped tool definition for a chat request. */
export function toOpenAiTool(tool: McpTool): OpenAiToolDefinition {
	const parameters = { ...tool.inputSchema };
	// Not part of the OpenAI tools schema.
	delete parameters['outputSchema'];
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters
		}
	};
}

/**
 * Cut a round's text at the state fence. Intermediate rounds must not carry a
 * state block into the assembled response — only the final round keeps one.
 */
export function stripFromStateFence(text: string): string {
	const index = text.search(STATE_FENCE_OPEN);
	return index === -1 ? text : text.slice(0, index);
}

export function toOpenAiToolCalls(calls: McpCollectedToolCall[]): OpenAiToolCall[] {
	return calls.map((call) => ({
		id: call.id,
		type: 'function',
		function: { name: call.name, arguments: JSON.stringify(call.args) }
	}));
}

export function buildAssistantToolMessage(text: string, calls: McpCollectedToolCall[]): LoopMessage {
	return {
		role: 'assistant',
		content: text,
		tool_calls: toOpenAiToolCalls(calls)
	};
}

/**
 * Tool-role messages for one round. Every call in the assistant message needs
 * a result (the OpenAI protocol requires it), so speech tool calls get a small
 * ack as well. `injectAsUser` adds a user-side copy for models that ignore the
 * strict tool role.
 */
export function buildToolResultMessages(entries: ToolResultEntry[]): LoopMessage[] {
	const messages: LoopMessage[] = [];
	for (const entry of entries) {
		messages.push({ role: 'tool', tool_call_id: entry.call.id, content: entry.content });
		if (entry.injectAsUser) {
			messages.push({
				role: 'user',
				content: `Tool result from ${entry.call.name}. Quote the following result exactly in your answer, preserving every item and all formatting:\n\n${entry.content}`
			});
		}
	}
	return messages;
}

/** Ack for a speech tool call, matching the server-side no-op tool result. */
export function speechToolAck(args: Record<string, unknown>): string {
	return JSON.stringify({ result: args });
}

export function mcpCallsOnly(
	calls: McpCollectedToolCall[],
	tools: McpTool[]
): McpCollectedToolCall[] {
	const names = new Set(tools.map((tool) => tool.name));
	return calls.filter((call) => names.has(call.name));
}

export function findMcpTool(tools: McpTool[], name: string): McpTool | undefined {
	return tools.find((tool) => tool.name === name);
}

/**
 * /api/mcp/chat — Agentic chat loop with MCP tool use.
 * Handles the full: LLM → tool_call → execute → LLM → ... → final answer cycle.
 * Returns a streaming response identical to /api/chat for seamless frontend integration.
 */
import type { RequestHandler } from './$types';
import type { McpServerConfig, McpTool } from '$lib/types/mcp';
import { callTool } from '$lib/services/mcp/client.server';
import { getChatBaseUrl } from '$lib/services/providers/local-endpoints';
import { normalizeChatBaseURL } from '$lib/services/chat/base-url';
import { isLocalLLMProvider } from '$lib/services/providers/local-endpoints';
import type { LLMProvider } from '$lib/types';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
}

interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

interface LLMResponse {
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			tool_calls?: ToolCall[];
		};
		finish_reason: string;
	}>;
}

const MAX_TOOL_ROUNDS = 5;

function toolsToOpenAI(tools: McpTool[]) {
	return tools.map((t) => ({
		type: 'function',
		function: {
			name: t.name,
			description: t.description,
			parameters: t.inputSchema
		}
	}));
}

/** Send a non-streaming request to an OpenAI-compatible endpoint */
async function llmRequest(
	url: string,
	model: string,
	messages: ChatMessage[],
	tools: McpTool[],
	apiKey?: string
): Promise<LLMResponse> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	const body: Record<string, unknown> = { model, messages, stream: false };
	if (tools.length > 0) {
		body.tools = toolsToOpenAI(tools);
		body.tool_choice = 'auto';
	}

	const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
	if (!res.ok) {
		const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
		throw new Error(err?.error?.message ?? `LLM error ${res.status}`);
	}
	return res.json() as Promise<LLMResponse>;
}

export const POST: RequestHandler = async ({ request }) => {
	const {
		messages,
		provider,
		model,
		baseURL,
		apiKey,
		systemPrompt,
		tools,
		servers
	} = (await request.json()) as {
		messages: Array<{ role: 'user' | 'assistant'; content: string }>;
		provider: string;
		model: string;
		baseURL?: string;
		apiKey?: string;
		systemPrompt?: string;
		tools: McpTool[];
		servers: McpServerConfig[];
	};

	// Resolve the OpenAI-compatible /chat/completions URL the same way /api/chat does
	const typedProvider = provider as LLMProvider;
	const isLocal = isLocalLLMProvider(provider);

	let resolvedBase = baseURL;
	if (isLocal) {
		resolvedBase = getChatBaseUrl(typedProvider, resolvedBase);
	}
	resolvedBase = normalizeChatBaseURL(typedProvider, resolvedBase) ?? resolvedBase;
	const chatUrl = `${(resolvedBase ?? '').replace(/\/+$/, '')}/chat/completions`;

	// Build a map for quick server lookup by tool name
	const toolServerMap = new Map<string, McpServerConfig>();
	for (const tool of tools) {
		const server = servers.find((s) => s.id === tool.serverId);
		if (server) toolServerMap.set(tool.name, server);
	}

	// Build initial message list
	const llmMessages: ChatMessage[] = [
		{
			role: 'system',
			content:
				systemPrompt ??
				'You are a helpful AI assistant. Use the available tools when they help answer the question.'
		},
		...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
	];

	let finalText = '';
	let toolCallSummary: string[] = [];

	// Agentic loop
	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await llmRequest(chatUrl, model, llmMessages, tools, apiKey);
		const choice = response.choices[0];

		if (!choice) throw new Error('Empty LLM response');

		const assistantMsg = choice.message;

		// No tool calls — we have the final answer
		if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
			finalText = assistantMsg.content ?? '';
			break;
		}

		// Add assistant message with tool calls to history
		llmMessages.push({
			role: 'assistant',
			content: assistantMsg.content,
			tool_calls: assistantMsg.tool_calls
		});

		// Execute each tool call in parallel
		const toolResults = await Promise.all(
			assistantMsg.tool_calls.map(async (tc) => {
				const server = toolServerMap.get(tc.function.name);
				if (!server) {
					return {
						tool_call_id: tc.id,
						name: tc.function.name,
						content: `Error: no server found for tool "${tc.function.name}"`
					};
				}

				let args: Record<string, unknown> = {};
				try {
					args = JSON.parse(tc.function.arguments);
				} catch {}

				const result = await callTool(server, tc.function.name, args);
				toolCallSummary.push(
					`🔧 **${tc.function.name}**: ${result.isError ? '❌' : '✅'} ${result.content.slice(0, 200)}`
				);
				return { tool_call_id: tc.id, name: tc.function.name, content: result.content };
			})
		);

		// Add tool results to message history
		for (const r of toolResults) {
			llmMessages.push({
				role: 'tool',
				tool_call_id: r.tool_call_id,
				content: r.content
			});
		}

		// If finish_reason was tool_calls but no content, loop continues
		if (choice.finish_reason === 'stop') {
			finalText = assistantMsg.content ?? '';
			break;
		}
	}

	if (!finalText) {
		finalText = 'I was unable to complete the request after using the available tools.';
	}

	// Stream the final text in the same SSE format as /api/chat
	// so the frontend needs no changes
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			// Optionally prepend tool call summary as a collapsible section
			if (toolCallSummary.length > 0) {
				const summaryBlock =
					`<details><summary>🔧 ${toolCallSummary.length} tool call(s)</summary>\n\n` +
					toolCallSummary.join('\n\n') +
					`\n\n</details>\n\n`;
				// Emit summary as first chunk
				controller.enqueue(encoder.encode(`0:${JSON.stringify(summaryBlock)}\n`));
			}

			// Emit final text word by word for a streaming feel
			const words = finalText.split(' ');
			for (const word of words) {
				controller.enqueue(encoder.encode(`0:${JSON.stringify(word + ' ')}\n`));
			}
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache'
		}
	});
};

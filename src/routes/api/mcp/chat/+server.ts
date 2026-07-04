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


interface TextPart {
	type: 'text';
	text: string;
}

interface ImagePart {
	type: 'image_url';
	image_url: { url: string };
}

type ContentPart = TextPart | ImagePart;

interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | ContentPart[] | null;
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

function logMcp(event: string, details: Record<string, unknown>) {
	// eslint-disable-next-line no-console
	console.log(`[MCP] ${event}`, JSON.stringify(details, null, 2));
}

const MAX_TOOL_ROUNDS = 5;

/** Try to extract a base64 image from an MCP tool result.
 *  Supports tools that return JSON like {"success":true,"mime_type":"image/png","data":"iVBORw0KGgo..."}.
 */
function extractImageFromToolResult(content: string): { mimeType: string; data: string } | null {
	try {
		const parsed = JSON.parse(content);
		if (parsed.success !== false && typeof parsed.data === 'string' && typeof parsed.mime_type === 'string') {
			const data = parsed.data.trim();
			if (data.length > 0) {
				return { mimeType: parsed.mime_type, data };
			}
		}
	} catch {
		// Not JSON — ignore
	}
	return null;
}

/** Extract optional system-prompt injections from tool descriptions.
 *  Tools can include a block like:
 *    [utsuwa-system-injection]
 *    When this tool is used, always do X.
 *    [/utsuwa-system-injection]
 *  This lets MCP servers influence the system prompt without changing Utsuwa code.
 */
function extractToolSystemInjections(tools: McpTool[]): string {
	const injections: string[] = [];
	const marker = /\[utsuwa-system-injection\]([\s\S]*?)\[\/utsuwa-system-injection\]/gi;
	for (const tool of tools) {
		let match: RegExpExecArray | null;
		while ((match = marker.exec(tool.description)) !== null) {
			const text = match[1].trim();
			if (text) injections.push(text);
		}
	}
	return injections.join('\n\n');
}

function toolsToOpenAI(tools: McpTool[]) {
	return tools.map((t) => {
		// Only send the fields the OpenAI tools schema expects.
		const parameters: Record<string, unknown> = { ...t.inputSchema };
		delete parameters['outputSchema'];
		return {
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters
			}
		};
	});
}

/**
 * Some local models (e.g. glm-5.2 via certain endpoints) emit tool calls as
 * `<tool_call>{"name":"...","arguments":{}}</tool_call>` text instead of the
 * OpenAI `tool_calls` array. This fallback parses those tags so the agentic
 * loop can still execute them.
 */
function extractToolCallsFromText(text: string | null): ToolCall[] {
	if (!text) return [];
	const calls: ToolCall[] = [];
	const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
	let match: RegExpExecArray | null;
	let idCounter = 1;
	while ((match = regex.exec(text)) !== null) {
		try {
			const parsed = JSON.parse(match[1].trim()) as {
				name?: string;
				arguments?: Record<string, unknown> | string;
			};
			if (parsed.name) {
				const args =
					typeof parsed.arguments === 'string'
						? parsed.arguments
						: JSON.stringify(parsed.arguments ?? {});
				calls.push({
					id: `toolu_fallback_${idCounter++}`,
					type: 'function',
					function: { name: parsed.name, arguments: args }
				});
			}
		} catch {
			// Ignore malformed tags
		}
	}
	return calls;
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
		servers,
		continueMode,
		continueFromText
	} = (await request.json()) as {
		messages: Array<{ role: 'user' | 'assistant'; content: string }>;
		provider: string;
		model: string;
		baseURL?: string;
		apiKey?: string;
		systemPrompt?: string;
		tools: McpTool[];
		servers: McpServerConfig[];
		continueMode?: boolean;
		continueFromText?: string;
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

	// Build continue-mode layer (mirrors prompt-builder.ts logic)
	let continueLayer = '';
	if (continueMode && continueFromText) {
		continueLayer = `\n\n<continue_mode>
The user asked you to continue your previous response.

CRITICAL RULES FOR CONTINUATION:
- Continue exactly from where your last response stopped
- Do not repeat, restart, summarize, or rephrase already written text
- Do not say things like "Okay, let's continue" or "Lass uns weitermachen"
- Start with the next word or sentence only
- Produce a substantial continuation when the request needs it

Already written (do not repeat):
"${continueFromText.slice(-500)}"
</continue_mode>`;
	}

	// Build initial message list
	const baseSystem =
		systemPrompt ??
		'You are a helpful AI assistant. Use the available tools when they help answer the question.';
	const toolInjections = extractToolSystemInjections(tools);
	const systemContent =
		baseSystem + continueLayer + (toolInjections ? '\n\n' + toolInjections : '');
	const llmMessages: ChatMessage[] = [
		{ role: 'system', content: systemContent },
		...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
	];

	let finalText = '';

	try {
	logMcp('chat start', { model, toolCount: tools.length, serverCount: servers.length });
	// Agentic loop
	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await llmRequest(chatUrl, model, llmMessages, tools, apiKey);
		const choice = response.choices[0];

		if (!choice) throw new Error('Empty LLM response');

		const assistantMsg = choice.message;
		logMcp('chat LLM response', { round, content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

		// Some models emit tool calls as <tool_call> text tags instead of the
		// OpenAI tool_calls array. Fall back to parsing them from the content.
		let toolCalls = assistantMsg.tool_calls ?? [];
		if (toolCalls.length === 0) {
			toolCalls = extractToolCallsFromText(assistantMsg.content);
			if (toolCalls.length > 0) {
				logMcp('chat fallback tool_calls parsed', { round, toolCalls });
			}
		}

		// No tool calls — we have the final answer
		if (toolCalls.length === 0) {
			finalText = assistantMsg.content ?? '';
			logMcp('chat final answer', { round, finalText });
			break;
		}

		// Add assistant message with tool calls to history
		llmMessages.push({
			role: 'assistant',
			content: assistantMsg.content,
			tool_calls: toolCalls
		});

		// Execute each tool call in parallel
		const toolResults = await Promise.all(
			toolCalls.map(async (tc) => {
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
				return {
					tool_call_id: tc.id,
					name: tc.function.name,
					content: result.content,
					injectAsUser: server.injectResultsAsUser ?? false
				};
			})
		);

		logMcp('chat tool results', { round, results: toolResults.map((r) => ({ name: r.name, content: r.content.slice(0, 500) })) });

		// Add tool results to message history
		for (const r of toolResults) {
			const image = extractImageFromToolResult(r.content);
			if (image) {
				// Keep a lightweight tool ack so the conversation structure is valid,
				// then inject the actual image as a multimodal user message.
				llmMessages.push({
					role: 'tool',
					tool_call_id: r.tool_call_id,
					content: `[${r.name} returned an image of type ${image.mimeType}]`
				});
				llmMessages.push({
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Here is the image returned by the tool:'
						},
						{
							type: 'image_url',
							image_url: { url: `data:${image.mimeType};base64,${image.data}` }
						}
					]
				});
			} else if (r.injectAsUser) {
				// Opt-in compatibility mode: present the tool result as a user-side
				// note. Some local/SLIM models ignore strict OpenAI tool-role
				// messages and respond better to this format.
				llmMessages.push({
					role: 'user',
					content: `[Tool result from ${r.name}]\n${r.content}`
				});
			} else {
				llmMessages.push({
					role: 'tool',
					tool_call_id: r.tool_call_id,
					content: r.content
				});
			}
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

	} catch (err) {
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Stream the final text in the same SSE format as /api/chat.
	// async start() with await between chunks causes Node.js to flush each chunk
	// to the HTTP socket individually — the browser receives them progressively,
	// so StreamingSpeechBuffer can detect sentence boundaries and start TTS
	// after the first sentence instead of waiting for the full response.
	const encoder = new TextEncoder();
	const yield_ = () => new Promise<void>((r) => setTimeout(r, 0));
	const stream = new ReadableStream({
		async start(controller) {

			// Emit sentence-by-sentence so the client can start TTS after the first sentence.
			// Each await yields to the event loop, letting Node.js flush the write buffer.
			const sentenceRe = /[^.!?…\n]*[.!?…]+[ \t]*/g;
			let last = 0;
			let match: RegExpExecArray | null;
			while ((match = sentenceRe.exec(finalText)) !== null) {
				const chunk = match[0];
				if (chunk.trim()) {
					controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n\n`));
					await yield_();
				}
				last = match.index + chunk.length;
			}
			// Remaining text (e.g. a sentence without terminal punctuation)
			const tail = finalText.slice(last);
			if (tail.trim()) {
				controller.enqueue(encoder.encode(`0:${JSON.stringify(tail)}\n\n`));
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

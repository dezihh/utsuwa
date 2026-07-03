/**
 * Lightweight MCP client — server-side only (Node.js).
 * Supports Streamable HTTP transport (POST JSON-RPC) and stdio transport.
 * No external SDK required — MCP is plain JSON-RPC 2.0.
 */

import type { McpServerConfig, McpTool, McpToolResult } from '$lib/types/mcp';
import { debugStore } from '$lib/stores/debug.svelte';

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

let _idCounter = 1;

function rpcId() {
	return _idCounter++;
}

function rpcRequest(method: string, params: unknown = {}) {
	return { jsonrpc: '2.0', id: rpcId(), method, params };
}

// ── HTTP transport ───────────────────────────────────────────────────────────

/** Per-URL MCP session IDs returned by Streamable HTTP initialize responses. */
const httpSessionIds = new Map<string, string>();

function normalizeMcpUrl(url: string): string {
	// MCP Streamable HTTP endpoints are usually mounted under a path ending in
	// a slash. A trailing slash avoids 307 redirects that some fetch
	// implementations follow with a changed method (leading to 405 errors).
	return url.replace(/\/?$/, '/');
}

async function httpRpc(url: string, method: string, params: unknown = {}): Promise<unknown> {
	const normalizedUrl = normalizeMcpUrl(url);
	const body = JSON.stringify(rpcRequest(method, params));
	const sessionId = httpSessionIds.get(normalizedUrl);

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream'
	};
	if (sessionId) headers['mcp-session-id'] = sessionId;

	debugStore.logMcp('HTTP request', { url: normalizedUrl, method, params, hasSessionId: !!sessionId });

	const res = await fetch(normalizedUrl, { method: 'POST', headers, body });

	if (!res.ok) {
		const errText = await res.text();
		debugStore.logMcp('HTTP error', { url: normalizedUrl, method, status: res.status, body: errText });
		throw new Error(`MCP HTTP error ${res.status}: ${errText}`);
	}

	// Update session ID if the server refreshes it.
	const newSessionId = res.headers.get('mcp-session-id');
	if (newSessionId) httpSessionIds.set(url, newSessionId);

	const contentType = res.headers.get('content-type') ?? '';

	// Streamable HTTP: server may respond with SSE
	if (contentType.includes('text/event-stream')) {
		const result = parseFirstSseResult(await res.text());
		debugStore.logMcp('HTTP response (SSE)', { url: normalizedUrl, method, result });
		return result;
	}

	const json = (await res.json()) as { result?: unknown; error?: { message: string } };
	if (json.error) {
		debugStore.logMcp('HTTP JSON-RPC error', { url: normalizedUrl, method, error: json.error });
		throw new Error(`MCP error: ${json.error.message}`);
	}
	debugStore.logMcp('HTTP response', { url: normalizedUrl, method, result: json.result });
	return json.result;
}

/** Parse the first 'data:' line from an SSE response */
function parseFirstSseResult(text: string): unknown {
	for (const line of text.split('\n')) {
		if (line.startsWith('data:')) {
			const json = JSON.parse(line.slice(5).trim()) as {
				result?: unknown;
				error?: { message: string };
			};
			if (json.error) throw new Error(`MCP error: ${json.error.message}`);
			return json.result;
		}
	}
	throw new Error('No data found in SSE response');
}

// ── stdio transport ──────────────────────────────────────────────────────────

interface StdioSession {
	write: (data: string) => void;
	readResponse: (id: number) => Promise<unknown>;
	close: () => void;
}

async function createStdioSession(config: McpServerConfig): Promise<StdioSession> {
	// Dynamic import — only available server-side in Node.js
	const { spawn } = await import('node:child_process');

	const proc = spawn(config.command!, config.args ?? [], {
		env: { ...process.env, ...(config.env ?? {}) },
		stdio: ['pipe', 'pipe', 'inherit']
	});

	const pending = new Map<number, (result: unknown) => void>();
	const errors = new Map<number, (err: Error) => void>();

	let buffer = '';
	proc.stdout.on('data', (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
				if (msg.id != null) {
					if (msg.error) {
						errors.get(msg.id)?.(new Error(msg.error.message));
					} else {
						pending.get(msg.id)?.(msg.result);
					}
					pending.delete(msg.id);
					errors.delete(msg.id);
				}
			} catch {
				// Ignore non-JSON lines
			}
		}
	});

	function write(data: string) {
		proc.stdin.write(data + '\n');
	}

	function readResponse(id: number): Promise<unknown> {
		return new Promise((resolve, reject) => {
			pending.set(id, resolve);
			errors.set(id, reject);
			setTimeout(() => {
				if (pending.has(id)) {
					pending.delete(id);
					errors.delete(id);
					reject(new Error(`MCP stdio timeout for request ${id}`));
				}
			}, 15_000);
		});
	}

	function close() {
		proc.stdin.end();
	}

	// Initialize the MCP session
	const initId = rpcId();
	write(
		JSON.stringify({
			jsonrpc: '2.0',
			id: initId,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: { tools: {} },
				clientInfo: { name: 'utsuwa', version: '1.0.0' }
			}
		})
	);
	await readResponse(initId);

	// Send initialized notification
	write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));

	return { write, readResponse, close };
}

async function stdioRpc(config: McpServerConfig, method: string, params: unknown = {}): Promise<unknown> {
	const session = await createStdioSession(config);
	try {
		const req = rpcRequest(method, params);
		session.write(JSON.stringify(req));
		const result = await session.readResponse(req.id as number);
		return result;
	} finally {
		session.close();
	}
}

// ── HTTP initialize (called once before listing tools) ───────────────────────

async function httpInitialize(url: string) {
	const normalizedUrl = normalizeMcpUrl(url);
	try {
		await httpRpc(normalizedUrl, 'initialize', {
			protocolVersion: '2024-11-05',
			capabilities: { tools: {} },
			clientInfo: { name: 'utsuwa', version: '1.0.0' }
		});
		// Send initialized notification (fire and forget)
		const sessionId = httpSessionIds.get(normalizedUrl);
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream'
		};
		if (sessionId) headers['mcp-session-id'] = sessionId;
		fetch(normalizedUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
		}).catch(() => {});
	} catch {
		// Some servers don't require initialize or ignore it — continue
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

/** List all tools from a single MCP server */
export async function listTools(config: McpServerConfig): Promise<McpTool[]> {
	try {
		debugStore.logMcp('listTools start', { server: config.name, url: config.url, transport: config.transport });
		let result: unknown;
		if (config.transport === 'http') {
			await httpInitialize(config.url!);
			result = await httpRpc(config.url!, 'tools/list', {});
		} else {
			result = await stdioRpc(config, 'tools/list', {});
		}

		const tools = (result as { tools?: Array<{
			name: string;
			description?: string;
			inputSchema?: Record<string, unknown>;
		}> })?.tools ?? [];

		const mapped = tools.map((t) => ({
			serverId: config.id,
			serverName: config.name,
			name: t.name,
			description: t.description ?? '',
			inputSchema: (t.inputSchema ?? { type: 'object' }) as McpTool['inputSchema']
		}));
		debugStore.logMcp('listTools result', { server: config.name, toolCount: mapped.length, tools: mapped.map((t) => t.name) });
		return mapped;
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		debugStore.logMcp('listTools error', { server: config.name, error });
		console.error(`[MCP] listTools failed for "${config.name}":`, err);
		return [];
	}
}

/** Call a tool on an MCP server and return the result */
export async function callTool(
	config: McpServerConfig,
	toolName: string,
	args: Record<string, unknown>
): Promise<McpToolResult> {
	try {
		debugStore.logMcp('callTool start', { server: config.name, toolName, args });
		let result: unknown;
		if (config.transport === 'http') {
			await httpInitialize(config.url!);
			result = await httpRpc(config.url!, 'tools/call', { name: toolName, arguments: args });
		} else {
			result = await stdioRpc(config, 'tools/call', { name: toolName, arguments: args });
		}

		// MCP tool result format: { content: [{type:'text', text:'...'}] }
		const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
		const text = content
			.filter((c) => c.type === 'text')
			.map((c) => c.text ?? '')
			.join('\n');

		const output = text || JSON.stringify(result);
		debugStore.logMcp('callTool result', { server: config.name, toolName, content: output });
		return { id: '', toolName, content: output, isError: false };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		debugStore.logMcp('callTool error', { server: config.name, toolName, error: msg });
		return { id: '', toolName, content: `Error: ${msg}`, isError: true };
	}
}

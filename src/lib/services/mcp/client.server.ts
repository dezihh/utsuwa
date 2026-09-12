/**
 * Server-side MCP client (Node.js only): Streamable HTTP via Node fetch and
 * stdio via child_process. stdio spawns a fresh process per request — simple
 * and stateless; long-lived sessions can come later if a server needs them.
 */
import type { McpServerConfig, McpTool, McpToolResult } from '$lib/types/mcp';
import { createHttpMcpClient } from './http-client.ts';
import {
	buildInitializedNotification,
	buildInitializeRequest,
	buildRpcRequest,
	nextRpcId,
	parseToolsList,
	stringifyToolResult
} from './protocol.ts';

const STDIO_REQUEST_TIMEOUT_MS = 15_000;

const httpClient = createHttpMcpClient((input, init) => fetch(input, init));

interface StdioSession {
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
	close(): void;
}

async function createStdioSession(config: McpServerConfig): Promise<StdioSession> {
	const { spawn } = await import('node:child_process');

	if (!config.command) throw new Error('MCP stdio server has no command configured');

	const proc = spawn(config.command, config.args ?? [], {
		env: { ...process.env, ...(config.env ?? {}) },
		stdio: ['pipe', 'pipe', 'inherit']
	});

	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

	let buffer = '';
	proc.stdout.on('data', (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line) as {
					id?: number;
					result?: unknown;
					error?: { message?: string };
				};
				if (msg.id == null) continue;
				const entry = pending.get(msg.id);
				if (!entry) continue;
				pending.delete(msg.id);
				if (msg.error) {
					entry.reject(new Error(`MCP error: ${msg.error.message ?? 'unknown error'}`));
				} else {
					entry.resolve(msg.result);
				}
			} catch {
				// Ignore non-JSON lines (servers may log to stdout)
			}
		}
	});

	proc.on('error', (err) => {
		for (const [id, entry] of pending) {
			pending.delete(id);
			entry.reject(err);
		}
	});

	proc.on('exit', (code) => {
		for (const [id, entry] of pending) {
			pending.delete(id);
			entry.reject(new Error(`MCP stdio process exited with code ${code ?? 'unknown'}`));
		}
	});

	function request(method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = nextRpcId();
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			proc.stdin.write(JSON.stringify(buildRpcRequest(id, method, params)) + '\n');
			setTimeout(() => {
				const entry = pending.get(id);
				if (entry) {
					pending.delete(id);
					entry.reject(new Error(`MCP stdio timeout for ${method}`));
				}
			}, STDIO_REQUEST_TIMEOUT_MS);
		});
	}

	function close() {
		proc.stdin.end();
	}

	// Initialize handshake before the session is usable.
	const initId = nextRpcId();
	await new Promise<void>((resolve, reject) => {
		pending.set(initId, { resolve: () => resolve(), reject });
		proc.stdin.write(JSON.stringify(buildInitializeRequest(initId)) + '\n');
		setTimeout(() => {
			const entry = pending.get(initId);
			if (entry) {
				pending.delete(initId);
				entry.reject(new Error('MCP stdio initialize timeout'));
			}
		}, STDIO_REQUEST_TIMEOUT_MS);
	});
	proc.stdin.write(JSON.stringify(buildInitializedNotification()) + '\n');

	return { request, close };
}

export async function listTools(config: McpServerConfig): Promise<McpTool[]> {
	if (config.transport === 'http') {
		return httpClient.listTools(config);
	}

	let session: StdioSession | null = null;
	try {
		session = await createStdioSession(config);
		const result = await session.request('tools/list', {});
		return parseToolsList(result).map((tool) => ({
			serverId: config.id,
			serverName: config.name,
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as McpTool['inputSchema']
		}));
	} finally {
		session?.close();
	}
}

export async function callTool(
	config: McpServerConfig,
	toolName: string,
	args: Record<string, unknown>
): Promise<McpToolResult> {
	if (config.transport === 'http') {
		return httpClient.callTool(config, toolName, args);
	}

	let session: StdioSession | null = null;
	try {
		session = await createStdioSession(config);
		const result = await session.request('tools/call', { name: toolName, arguments: args });
		return { toolName, content: stringifyToolResult(result), isError: false };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[MCP] callTool failed for "${config.name}/${toolName}":`, message);
		return { toolName, content: `Error: ${message}`, isError: true };
	} finally {
		session?.close();
	}
}

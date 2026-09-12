/**
 * Server-side MCP client (Node.js only): Streamable HTTP via Node fetch and
 * stdio via child_process. stdio spawns a fresh process per request — simple
 * and stateless; long-lived sessions can come later if a server needs them.
 */
import type { McpServerConfig, McpTool, McpToolResult } from '$lib/types/mcp';
import { createHttpMcpClient, type FetchLike } from './http-client.ts';
import {
	buildInitializedNotification,
	buildInitializeRequest,
	buildRpcRequest,
	isBlockedMcpHost,
	mergeStdioEnv,
	nextRpcId,
	parseToolsList,
	stringifyToolResult
} from './protocol.ts';

const STDIO_REQUEST_TIMEOUT_MS = 15_000;

const hostCheckCache = new Map<string, { blocked: boolean; checkedAt: number }>();
const HOST_CHECK_TTL_MS = 5 * 60 * 1000;
let warnedDnsUnavailable = false;

function warnDnsCheckUnavailable(): void {
	if (warnedDnsUnavailable) return;
	warnedDnsUnavailable = true;
	console.warn(
		'[MCP] node:dns is unavailable — only literal link-local/metadata addresses are filtered.'
	);
}

/**
 * Server-side SSRF guard: link-local and metadata hosts are rejected before
 * any request, including hostnames that resolve to such an address. Loopback
 * and RFC1918 stay allowed — self-hosted MCP servers live there.
 */
async function assertAllowedHost(rawUrl: string): Promise<void> {
	let hostname: string;
	try {
		hostname = new URL(rawUrl).hostname;
	} catch {
		return; // let fetch report the invalid URL
	}
	if (isBlockedMcpHost(hostname)) {
		throw new Error(`MCP HTTP host "${hostname}" is blocked (link-local/metadata)`);
	}
	// Literal addresses are covered above; only resolve names.
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return;
	const cached = hostCheckCache.get(hostname);
	if (cached && Date.now() - cached.checkedAt < HOST_CHECK_TTL_MS) {
		if (cached.blocked) {
			throw new Error(`MCP HTTP host "${hostname}" is blocked (resolves to link-local/metadata)`);
		}
		return;
	}
	let lookup: typeof import('node:dns/promises').lookup;
	try {
		({ lookup } = await import('node:dns/promises'));
	} catch {
		warnDnsCheckUnavailable();
		return;
	}
	try {
		const addresses = await lookup(hostname, { all: true });
		const blocked = addresses.some((entry) => isBlockedMcpHost(entry.address));
		hostCheckCache.set(hostname, { blocked, checkedAt: Date.now() });
		if (blocked) {
			throw new Error(`MCP HTTP host "${hostname}" is blocked (resolves to link-local/metadata)`);
		}
	} catch (err) {
		// DNS failures surface through fetch with their real message.
		if (err instanceof Error && err.message.includes('is blocked')) throw err;
	}
}

const serverFetch: FetchLike = async (input, init) => {
	await assertAllowedHost(String(input));
	return fetch(input, init);
};

const httpClient = createHttpMcpClient(serverFetch);

interface StdioSession {
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
	close(): void;
}

async function createStdioSession(config: McpServerConfig): Promise<StdioSession> {
	const { spawn } = await import('node:child_process');

	if (!config.command) throw new Error('MCP stdio server has no command configured');

	const proc = spawn(config.command, config.args ?? [], {
		env: mergeStdioEnv(process.env, config.env),
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
		// A server that ignores stdin EOF must not leak: SIGTERM after a short
		// grace, SIGKILL if it still does not exit. unref() keeps the timers
		// from holding the process open.
		const termTimer = setTimeout(() => {
			if (proc.exitCode === null && proc.signalCode === null) {
				try {
					proc.kill('SIGTERM');
				} catch {
					// already gone
				}
				const killTimer = setTimeout(() => {
					if (proc.exitCode === null && proc.signalCode === null) {
						try {
							proc.kill('SIGKILL');
						} catch {
							// already gone
						}
					}
				}, 2000);
				killTimer.unref?.();
			}
		}, 1000);
		termTimer.unref?.();
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

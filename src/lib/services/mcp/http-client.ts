/**
 * Streamable HTTP transport for MCP — fetch-injectable so the same protocol
 * code runs on the server (Node fetch) and on desktop (Tauri HTTP plugin,
 * which bypasses webview CORS).
 */
import type { McpServerConfig, McpTool, McpToolResult } from '$lib/types/mcp';
import {
	buildAuthHeaders,
	buildInitializedNotification,
	buildRpcRequest,
	isAllowedMcpHttpUrl,
	mcpUrlCandidates,
	nextRpcId,
	parseJsonRpcResult,
	parseSseResult,
	parseToolsList,
	stringifyToolResult
} from './protocol.ts';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpMcpClient {
	listTools(config: McpServerConfig): Promise<McpTool[]>;
	callTool(
		config: McpServerConfig,
		toolName: string,
		args: Record<string, unknown>
	): Promise<McpToolResult>;
}

export function createHttpMcpClient(fetchImpl: FetchLike): HttpMcpClient {
	/** Session ids returned by Streamable HTTP initialize responses, per URL. */
	const sessionIds = new Map<string, string>();
	/** Working URL variant per configured URL (some servers 404 on a trailing slash). */
	const resolvedUrls = new Map<string, string>();

	function candidatesFor(config: McpServerConfig): string[] {
		const key = (config.url ?? '').trim();
		const known = resolvedUrls.get(key);
		return known ? [known] : mcpUrlCandidates(key);
	}

	function headersFor(config: McpServerConfig, url: string): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...buildAuthHeaders(config.auth)
		};
		const sessionId = sessionIds.get(url);
		if (sessionId) headers['mcp-session-id'] = sessionId;
		return headers;
	}

	async function rpc(config: McpServerConfig, method: string, params: unknown = {}): Promise<unknown> {
		const key = (config.url ?? '').trim();
		if (!isAllowedMcpHttpUrl(key)) {
			throw new Error('MCP HTTP URL must use http: or https:');
		}
		const urls = candidatesFor(config);
		if (urls.length === 0) throw new Error('MCP HTTP server has no URL configured');

		let lastError: Error | null = null;
		for (const url of urls) {
			const res = await fetchImpl(url, {
				method: 'POST',
				headers: headersFor(config, url),
				body: JSON.stringify(buildRpcRequest(nextRpcId(), method, params))
			});

			// Wrong URL variant (e.g. Home Assistant 404s on a trailing slash):
			// drain and try the next candidate. Auth errors are not retried.
			if (res.status === 404 || res.status === 405) {
				await res.text().catch(() => '');
				lastError = new Error(`MCP HTTP error ${res.status}: ${url}`);
				continue;
			}

			if (!res.ok) {
				const errText = await res.text().catch(() => '');
				const detail = errText ? `: ${errText.slice(0, 300)}` : '';
				throw new Error(`MCP HTTP error ${res.status}${detail}`);
			}

			// Remember the variant that worked so later calls skip the probing.
			resolvedUrls.set(key, url);

			// The server may refresh the session id at any point.
			const newSessionId = res.headers.get('mcp-session-id');
			if (newSessionId) sessionIds.set(url, newSessionId);

			const contentType = res.headers.get('content-type') ?? '';
			if (contentType.includes('text/event-stream')) {
				return parseSseResult(await res.text());
			}
			return parseJsonRpcResult(await res.json());
		}
		throw lastError ?? new Error('MCP HTTP request failed');
	}

	/**
	 * Some servers require the initialize handshake before any other request.
	 * Servers that don't care simply ignore it — failures are non-fatal.
	 */
	async function initialize(config: McpServerConfig): Promise<void> {
		try {
			await rpc(config, 'initialize', {
				protocolVersion: '2024-11-05',
				capabilities: { tools: {} },
				clientInfo: { name: 'utsuwa', version: '1.0.0' }
			});
			const key = (config.url ?? '').trim();
			const url = resolvedUrls.get(key) ?? mcpUrlCandidates(key)[0];
			if (!url) return;
			// Fire-and-forget notification, exactly as the spec prescribes.
			await fetchImpl(url, {
				method: 'POST',
				headers: headersFor(config, url),
				body: JSON.stringify(buildInitializedNotification())
			}).catch(() => {});
		} catch {
			// Servers without a handshake still work; the real call reports errors.
		}
	}

	async function listTools(config: McpServerConfig): Promise<McpTool[]> {
		await initialize(config);
		const result = await rpc(config, 'tools/list', {});
		return parseToolsList(result).map((tool) => ({
			serverId: config.id,
			serverName: config.name,
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as McpTool['inputSchema']
		}));
	}

	async function callTool(
		config: McpServerConfig,
		toolName: string,
		args: Record<string, unknown>
	): Promise<McpToolResult> {
		try {
			await initialize(config);
			const result = await rpc(config, 'tools/call', { name: toolName, arguments: args });
			return { toolName, content: stringifyToolResult(result), isError: false };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[MCP] callTool failed for "${config.name}/${toolName}":`, message);
			return { toolName, content: `Error: ${message}`, isError: true };
		}
	}

	return { listTools, callTool };
}

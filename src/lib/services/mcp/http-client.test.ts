import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpMcpClient, type FetchLike } from './http-client.ts';
import type { McpServerConfig } from '$lib/types/mcp';

const CONFIG: McpServerConfig = {
	id: 'ha',
	name: 'Home Assistant',
	transport: 'http',
	url: 'http://ha.local:8123/api/mcp',
	auth: { type: 'bearer', token: 'test-token' },
	enabled: true
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function rpcReply(body: string) {
	const msg = JSON.parse(body) as { id?: number; method?: string };
	if (msg.method === 'initialize') {
		return jsonResponse({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } });
	}
	if (msg.method === 'tools/list') {
		return jsonResponse({
			jsonrpc: '2.0',
			id: msg.id,
			result: { tools: [{ name: 'get_state', inputSchema: { type: 'object' } }] }
		});
	}
	return jsonResponse({});
}

test('listTools succeeds against a strict server that 404s on a trailing slash', async () => {
	const calls: string[] = [];
	const fetchImpl: FetchLike = async (input, init) => {
		const url = String(input);
		calls.push(url);
		if (url.endsWith('/api/mcp/')) return new Response('404: Not Found', { status: 404 });
		return rpcReply(String(init?.body));
	};

	const client = createHttpMcpClient(fetchImpl);
	const tools = await client.listTools(CONFIG);

	assert.equal(tools.length, 1);
	assert.equal(tools[0].name, 'get_state');
	// The configured form already works — the slash variant is never probed.
	assert.equal(calls.every((url) => !url.endsWith('/api/mcp/')), true);
});

test('listTools falls back to the slash variant when the configured form 404s', async () => {
	const calls: string[] = [];
	const fetchImpl: FetchLike = async (input, init) => {
		const url = String(input);
		calls.push(url);
		if (!url.endsWith('/api/mcp/')) return new Response('404: Not Found', { status: 404 });
		return rpcReply(String(init?.body));
	};

	const client = createHttpMcpClient(fetchImpl);
	const tools = await client.listTools(CONFIG);
	assert.equal(tools.length, 1);
	assert.equal(calls.some((url) => url.endsWith('/api/mcp/')), true);

	// The working variant is cached: a second call skips the probing.
	const before = calls.filter((url) => !url.endsWith('/api/mcp/')).length;
	await client.listTools(CONFIG);
	assert.equal(calls.filter((url) => !url.endsWith('/api/mcp/')).length, before);
});

test('auth errors are final — no variant probing and a readable tool error', async () => {
	const calls: string[] = [];
	const fetchImpl: FetchLike = async (input) => {
		calls.push(String(input));
		return new Response('401: Unauthorized', { status: 401 });
	};

	const client = createHttpMcpClient(fetchImpl);
	const result = await client.callTool(CONFIG, 'get_state', {});

	assert.equal(result.isError, true);
	assert.match(result.content, /401/);
	// initialize + tools/call, both only against the configured form.
	assert.equal(calls.every((url) => !url.endsWith('/api/mcp/')), true);
});

test('HTTP requests abort after the configured timeout', async () => {
	const hanging: FetchLike = (_input, init) =>
		new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () =>
				reject(new DOMException('aborted', 'TimeoutError'))
			);
		});

	const client = createHttpMcpClient(hanging, { timeoutMs: 20 });
	const result = await client.callTool(CONFIG, 'get_state', {});

	assert.equal(result.isError, true);
	assert.match(result.content, /timeout after 20ms/);
});

test('session ids are scoped to the server, not just the URL', async () => {
	const requests: Array<{ method: string; session: string | undefined; auth: string | undefined }> = [];
	const fetchImpl: FetchLike = async (_input, init) => {
		const headers = (init?.headers ?? {}) as Record<string, string>;
		const body = JSON.parse(String(init?.body)) as { id?: number; method?: string };
		requests.push({
			method: body.method ?? '',
			session: headers['mcp-session-id'],
			auth: headers.Authorization ?? headers.authorization
		});
		if (body.method === 'initialize') {
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'mcp-session-id': 'session-1' }
			});
		}
		return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [] } });
	};

	const client = createHttpMcpClient(fetchImpl);
	await client.listTools(CONFIG);
	// Same URL, different server identity: must not inherit the session.
	await client.listTools({ ...CONFIG, id: 'ha-2', auth: { type: 'bearer', token: 'other-token' } });

	const secondInit = requests.filter((r) => r.method === 'initialize')[1];
	assert.equal(secondInit.session, undefined, 'the second server starts a fresh session');
	assert.equal(secondInit.auth, 'Bearer other-token');
});

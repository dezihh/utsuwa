import type { RequestHandler } from './$types';
import type { McpServerConfig } from '$lib/types/mcp';
import { listTools } from '$lib/services/mcp/client.server';

const MCP_ENABLED = process.env.UTSUWA_MCP_ENABLED === 'true';

export const POST: RequestHandler = async ({ request }) => {
	if (!MCP_ENABLED) {
		return new Response(JSON.stringify({ error: 'MCP is disabled on this server' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { servers } = (await request.json()) as { servers: McpServerConfig[] };
	const enabled = servers.filter((s) => s.enabled);

	const allTools = (await Promise.all(enabled.map(listTools))).flat();

	return new Response(JSON.stringify({ tools: allTools }), {
		headers: { 'Content-Type': 'application/json' }
	});
};

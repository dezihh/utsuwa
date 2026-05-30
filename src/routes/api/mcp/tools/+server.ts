import type { RequestHandler } from './$types';
import type { McpServerConfig } from '$lib/types/mcp';
import { listTools } from '$lib/services/mcp/client.server';

export const POST: RequestHandler = async ({ request }) => {
	const { servers } = (await request.json()) as { servers: McpServerConfig[] };
	const enabled = servers.filter((s) => s.enabled);

	const allTools = (await Promise.all(enabled.map(listTools))).flat();

	return new Response(JSON.stringify({ tools: allTools }), {
		headers: { 'Content-Type': 'application/json' }
	});
};

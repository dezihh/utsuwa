import type { RequestHandler } from './$types';
import type { McpServerConfig } from '$lib/types/mcp';
import { callTool } from '$lib/services/mcp/client.server';

export const POST: RequestHandler = async ({ request }) => {
	const { server, toolName, args } = (await request.json()) as {
		server: McpServerConfig;
		toolName: string;
		args: Record<string, unknown>;
	};

	const result = await callTool(server, toolName, args ?? {});

	return new Response(JSON.stringify(result), {
		headers: { 'Content-Type': 'application/json' }
	});
};

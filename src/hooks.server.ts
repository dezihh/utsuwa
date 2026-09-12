/**
 * Server startup notices. Runs once when the server boots (SvelteKit `init`).
 *
 * MCP is opt-in, but stdio is effectively remote code execution for anyone who
 * can reach the app: warn when it is enabled without a command allowlist.
 */
import type { ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isServerMcpEnabled } from '$lib/services/mcp/protocol';

export const init: ServerInit = () => {
	if (isServerMcpEnabled(env.MCP_ENABLED) && !env.MCP_STDIO_ALLOWED_COMMANDS) {
		console.warn(
			'[MCP] stdio servers are unrestricted — set MCP_STDIO_ALLOWED_COMMANDS to allowlist commands.'
		);
	}
};

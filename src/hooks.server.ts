/**
 * Server startup notices. Runs once when the server boots (SvelteKit `init`).
 *
 * MCP is opt-in, but stdio is effectively remote code execution for anyone who
 * can reach the app: warn when it is enabled without a command allowlist.
 */
import type { ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isServerMcpEnabled, parseToolNameList } from '$lib/services/mcp/protocol';

export const init: ServerInit = () => {
	if (!isServerMcpEnabled(env.MCP_ENABLED)) return;
	const allowed = parseToolNameList(env.MCP_STDIO_ALLOWED_COMMANDS);
	if (allowed.length === 0) {
		console.warn(
			'[MCP] stdio is disabled — set MCP_STDIO_ALLOWED_COMMANDS to allowlist commands.'
		);
		return;
	}
	if (allowed.includes('*')) {
		console.warn('[MCP] stdio allows every command (MCP_STDIO_ALLOWED_COMMANDS=*).');
	}
};

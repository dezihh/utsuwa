// MCP (Model Context Protocol) types

export type McpTransport = 'http' | 'stdio';

export interface McpServerConfig {
	id: string;
	name: string;
	transport: McpTransport;
	/** HTTP transport: base URL of the MCP server (e.g. http://localhost:3000/mcp) */
	url?: string;
	/** stdio transport: command to spawn (e.g. "npx", "python") */
	command?: string;
	/** stdio transport: arguments for the command */
	args?: string[];
	/** Optional env vars for stdio transport */
	env?: Record<string, string>;
	enabled: boolean;
}

export interface McpTool {
	/** ID of the McpServerConfig this tool belongs to */
	serverId: string;
	serverName: string;
	name: string;
	description: string;
	/** JSON Schema for the tool's input */
	inputSchema: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
}

export interface McpToolCall {
	/** Unique call ID (from LLM) */
	id: string;
	toolName: string;
	serverId: string;
	args: Record<string, unknown>;
}

export interface McpToolResult {
	id: string;
	toolName: string;
	/** Stringified result content */
	content: string;
	isError: boolean;
}

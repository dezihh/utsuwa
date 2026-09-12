/**
 * MCP server + tool state. Server configs live in localStorage (like the other
 * provider keys); the capability probe tells the web build whether the server
 * has MCP enabled (`MCP_ENABLED=server`) — on desktop the client-side path is
 * always available.
 */
import { browser } from '$app/environment';
import type { McpServerConfig, McpServerError, McpTool } from '$lib/types/mcp';
import { getMcpCapability, listTools } from '$lib/services/mcp/capability';

const STORAGE_KEY = 'utsuwa-mcp-v1';

export type McpCapabilityState = 'unknown' | 'server' | 'client' | 'none';

function loadSaved(): McpServerConfig[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as McpServerConfig[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function persist(next: McpServerConfig[]) {
	if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

let servers = $state<McpServerConfig[]>(loadSaved());
let tools = $state<McpTool[]>([]);
let serverErrors = $state<McpServerError[]>([]);
let isLoadingTools = $state(false);
let toolsError = $state<string | null>(null);
let capability = $state<McpCapabilityState>('unknown');

/**
 * Probe the server route once: a 404 means MCP is disabled on this deployment,
 * so the settings page can explain why nothing works and the chat never sends
 * MCP tools.
 */
async function detectCapability(): Promise<void> {
	if (getMcpCapability() === 'client') {
		capability = 'client';
		return;
	}
	try {
		const res = await fetch('/api/mcp/tools', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ servers: [] })
		});
		capability = res.status === 404 ? 'none' : res.ok ? 'server' : 'none';
	} catch {
		capability = 'none';
	}
}

async function fetchTools(): Promise<void> {
	const enabled = servers.filter((s) => s.enabled);
	if (enabled.length === 0) {
		tools = [];
		serverErrors = [];
		toolsError = null;
		return;
	}
	if (capability === 'unknown') await detectCapability();
	if (capability === 'none') {
		tools = [];
		serverErrors = [];
		return;
	}

	isLoadingTools = true;
	toolsError = null;
	try {
		const result = await listTools(enabled);
		tools = result.tools;
		serverErrors = result.errors;
	} catch (err) {
		toolsError = err instanceof Error ? err.message : 'Failed to load tools';
		tools = [];
		serverErrors = [];
	} finally {
		isLoadingTools = false;
	}
}

/**
 * Lazy load used by the chat pipeline: only hits the network when servers are
 * configured and tools are not loaded yet.
 */
async function ensureTools(): Promise<void> {
	if (!servers.some((s) => s.enabled)) return;
	if (capability === 'unknown') await detectCapability();
	if (capability === 'none') return;
	if (tools.length > 0 || isLoadingTools) return;
	await fetchTools();
}

export const mcpStore = {
	get servers() {
		return servers;
	},
	get tools() {
		return tools;
	},
	get serverErrors() {
		return serverErrors;
	},
	get isLoadingTools() {
		return isLoadingTools;
	},
	get toolsError() {
		return toolsError;
	},
	get capability() {
		return capability;
	},
	get serverEnabled() {
		return capability === 'server' || capability === 'client';
	},
	get enabledServers() {
		return servers.filter((s) => s.enabled);
	},
	get hasActiveTools() {
		return (capability === 'server' || capability === 'client') && tools.length > 0;
	},

	addServer(config: Omit<McpServerConfig, 'id'>) {
		const newServer: McpServerConfig = { ...config, id: crypto.randomUUID() };
		servers = [...servers, newServer];
		persist(servers);
		if (newServer.enabled) void fetchTools();
	},

	updateServer(id: string, updates: Partial<McpServerConfig>) {
		servers = servers.map((s) => (s.id === id ? { ...s, ...updates } : s));
		persist(servers);
		void fetchTools();
	},

	removeServer(id: string) {
		servers = servers.filter((s) => s.id !== id);
		persist(servers);
		void fetchTools();
	},

	toggleServer(id: string) {
		servers = servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
		persist(servers);
		void fetchTools();
	},

	refreshTools: fetchTools,
	ensureTools,
	detectCapability
};

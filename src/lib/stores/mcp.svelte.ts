import type { McpServerConfig, McpTool } from '$lib/types/mcp';

const STORAGE_KEY = 'utsuwa-mcp-v1';

function loadSaved(): McpServerConfig[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as McpServerConfig[];
	} catch {}
	return [];
}

function persist(servers: McpServerConfig[]) {
	if (typeof window !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
	}
}

let servers = $state<McpServerConfig[]>(loadSaved());
let tools = $state<McpTool[]>([]);
let isLoadingTools = $state(false);
let toolsError = $state<string | null>(null);

async function fetchTools() {
	const enabled = servers.filter((s) => s.enabled);
	if (enabled.length === 0) {
		tools = [];
		return;
	}
	isLoadingTools = true;
	toolsError = null;
	try {
		const res = await fetch('/api/mcp/tools', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ servers: enabled })
		});
		const data = (await res.json()) as { tools: McpTool[] };
		tools = data.tools ?? [];
	} catch (err) {
		toolsError = err instanceof Error ? err.message : 'Failed to load tools';
		tools = [];
	} finally {
		isLoadingTools = false;
	}
}

export const mcpStore = {
	get servers() {
		return servers;
	},
	get tools() {
		return tools;
	},
	get isLoadingTools() {
		return isLoadingTools;
	},
	get toolsError() {
		return toolsError;
	},
	get enabledServers() {
		return servers.filter((s) => s.enabled);
	},
	get hasActiveTools() {
		return tools.length > 0;
	},

	addServer(config: Omit<McpServerConfig, 'id'>) {
		const newServer: McpServerConfig = { ...config, id: crypto.randomUUID() };
		servers = [...servers, newServer];
		persist(servers);
		if (newServer.enabled) fetchTools();
	},

	updateServer(id: string, updates: Partial<McpServerConfig>) {
		servers = servers.map((s) => (s.id === id ? { ...s, ...updates } : s));
		persist(servers);
		fetchTools();
	},

	removeServer(id: string) {
		servers = servers.filter((s) => s.id !== id);
		persist(servers);
		fetchTools();
	},

	toggleServer(id: string) {
		servers = servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
		persist(servers);
		fetchTools();
	},

	refreshTools: fetchTools
};

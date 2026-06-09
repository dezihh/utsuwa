import { browser } from '$app/environment';

export interface DebugSettings {
	/** Log system prompts before every LLM call */
	logSystemPrompts: boolean;
	/** Show debug panel overlay */
	showDebugPanel: boolean;
	/** Log memory retrieval details */
	logMemoryRetrieval: boolean;
	/** Log session lifecycle events */
	logSessionLifecycle: boolean;
	/** Log fact library operations */
	logFactLibrary: boolean;
	/** Maximum number of log entries to keep in memory */
	maxLogEntries: number;
}

export interface LogEntry {
	timestamp: Date;
	category: 'prompt' | 'memory' | 'session' | 'fact' | 'evolution' | 'general';
	title: string;
	content: string;
}

const STORAGE_KEY = 'utsuwa-debug-settings';

const DEFAULT_SETTINGS: DebugSettings = {
	logSystemPrompts: false,
	showDebugPanel: false,
	logMemoryRetrieval: false,
	logSessionLifecycle: false,
	logFactLibrary: false,
	maxLogEntries: 100
};

function createDebugStore() {
	let settings = $state<DebugSettings>({ ...DEFAULT_SETTINGS });
	let logEntries = $state<LogEntry[]>([]);
	let panelVisible = $state(false);

	// Load from localStorage
	if (browser) {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				settings = { ...DEFAULT_SETTINGS, ...parsed };
			}
		} catch {
			// ignore
		}
	}

	function persist() {
		if (browser) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		}
	}

	function updateSetting<K extends keyof DebugSettings>(key: K, value: DebugSettings[K]) {
		settings = { ...settings, [key]: value };
		persist();
		if (key === 'showDebugPanel') {
			panelVisible = value as boolean;
		}
	}

	function togglePanel() {
		panelVisible = !panelVisible;
	}

	function addLog(entry: Omit<LogEntry, 'timestamp'>) {
		if (!browser) return;
		const fullEntry: LogEntry = { ...entry, timestamp: new Date() };
		logEntries = [fullEntry, ...logEntries].slice(0, settings.maxLogEntries);
		// Also log to console for convenience
		console.log(`[${entry.category.toUpperCase()}] ${entry.title}`, entry.content);
	}

	function clearLogs() {
		logEntries = [];
	}

	function logPrompt(systemPrompt: string, userMessage: string) {
		if (!settings.logSystemPrompts) return;
		addLog({
			category: 'prompt',
			title: `System Prompt (${systemPrompt.length} chars)`,
			content: `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== USER MESSAGE ===\n${userMessage}`
		});
	}

	function logMemory(ctx: {
		recentTurns: number;
		relevantFacts: number;
		triggeredMemories: number;
		recentSessions: number;
		factLibraryEntries: number;
	}) {
		if (!settings.logMemoryRetrieval) return;
		addLog({
			category: 'memory',
			title: `Memory Retrieved`,
			content: `Recent turns: ${ctx.recentTurns}\nRelevant facts: ${ctx.relevantFacts}\nTriggered memories: ${ctx.triggeredMemories}\nRecent sessions: ${ctx.recentSessions}\nFact library entries: ${ctx.factLibraryEntries}`
		});
	}

	function logSession(event: string, details?: string) {
		if (!settings.logSessionLifecycle) return;
		addLog({
			category: 'session',
			title: event,
			content: details || ''
		});
	}

	function logFact(action: string, key: string, type?: string) {
		if (!settings.logFactLibrary) return;
		addLog({
			category: 'fact',
			title: action,
			content: `Key: ${key}${type ? ` | Type: ${type}` : ''}`
		});
	}

	return {
		// Settings
		get settings() { return settings; },
		updateSetting,

		// Panel
		get panelVisible() { return panelVisible; },
		togglePanel,

		// Logs
		get logEntries() { return logEntries; },
		addLog,
		clearLogs,

		// Convenience loggers
		logPrompt,
		logMemory,
		logSession,
		logFact
	};
}

export const debugStore = createDebugStore();

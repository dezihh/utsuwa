import { browser } from '$app/environment';

export interface DebugSettings {
	/** Log system prompts before every LLM call */
	logSystemPrompts: boolean;
	/** Log memory retrieval details */
	logMemoryRetrieval: boolean;
	/** Log session lifecycle events */
	logSessionLifecycle: boolean;
	/** Log fact library operations */
	logFactLibrary: boolean;
	/** Log TTS artifacts filtered from speech */
	logSpeechArtifacts: boolean;
	/** Log each TTS segment with language and assigned voice */
	logTtsSegments: boolean;
}

const STORAGE_KEY = 'utsuwa-debug-settings';

const DEFAULT_SETTINGS: DebugSettings = {
	logSystemPrompts: true,
	logMemoryRetrieval: true,
	logSessionLifecycle: true,
	logFactLibrary: true,
	logSpeechArtifacts: true,
	logTtsSegments: true
};

function createDebugStore() {
	let settings = $state<DebugSettings>({ ...DEFAULT_SETTINGS });

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
	}

	function addLog(entry: { category: string; title: string; content: string }) {
		// All debug output goes to the console (browser F12 or server logs).
		// eslint-disable-next-line no-console
		console.log(`[${entry.category.toUpperCase()}] ${entry.title}`, entry.content);
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

	function logSpeechArtifact(artifacts: string[]) {
		if (!settings.logSpeechArtifacts || artifacts.length === 0) return;
		addLog({
			category: 'speech',
			title: `TTS Filtered Artifacts (${artifacts.length})`,
			content: artifacts.map((a) => `- ${a}`).join('\n')
		});
	}

	function logTTSSegment(segment: { text: string; language?: string; voiceId?: string }, resolvedVoiceId?: string) {
		if (!settings.logTtsSegments) return;
		addLog({
			category: 'speech',
			title: `TTS Segment (${segment.language || 'auto'})`,
			content: `text: "${segment.text}"\nlanguage: ${segment.language || '-'}\nvoiceId tag: ${segment.voiceId || '-'}\nresolved voice: ${resolvedVoiceId || '-'}`
		});
	}

	function logTTSRequest(provider: string, body: Record<string, unknown>) {
		if (!settings.logTtsSegments) return;
		addLog({
			category: 'speech',
			title: `TTS Request (${provider})`,
			content: JSON.stringify(body, null, 2)
		});
	}


	return {
		// Settings
		get settings() { return settings; },
		updateSetting,

		// Convenience loggers
		addLog,
		logPrompt,
		logMemory,
		logSession,
		logFact,
		logSpeechArtifact,
		logTTSSegment,
		logTTSRequest,
	};
}

export const debugStore = createDebugStore();

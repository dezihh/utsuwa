import { browser } from '$app/environment';
import { streamChatDirect } from '$lib/services/chat/client-chat';
import { getLLMProvider } from '$lib/services/providers/registry';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modulesStore } from '$lib/stores/modules.svelte';
import type { ConversationTurn } from '$lib/types/memory';

export interface SessionSummaryResult {
	summary: string;
	keyTopics: string[];
	emotionalArc: string;
}

const SUMMARY_SYSTEM_PROMPT = `You are a memory summarization assistant. Your task is to analyze a conversation transcript and produce a concise, meaningful summary.

Analyze the conversation carefully and output ONLY valid JSON in this exact format:

{
  "summary": "2-4 sentences describing what was discussed, the overall tone, and any significant moments. Be specific about topics.",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "emotionalArc": "Brief description of how the emotional tone evolved during the conversation (e.g., 'Started playful, became serious when discussing work, ended on a warm note')"
}

Rules:
- summary: Natural language, past tense, 2-4 sentences. Include specific topics discussed.
- keyTopics: 3-5 tags, lowercase, single words or short phrases. Be specific (e.g., "spanish_vocab" not "language").
- emotionalArc: One concise sentence about the emotional journey.
- Output ONLY the JSON object. No markdown, no explanations, no code blocks.`;

/**
 * Generate a session summary using the configured LLM.
 * Falls back to heuristic summary on failure or timeout.
 */
export async function generateSessionSummary(
	turns: ConversationTurn[],
	companionName: string
): Promise<SessionSummaryResult> {
	if (!browser || turns.length === 0) {
		return fallbackSummary(turns);
	}

	// Get LLM configuration from stores
	const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
	const providerId = consciousnessSettings.activeProvider as string;
	const model = consciousnessSettings.activeModel as string;

	if (!providerId) {
		console.warn('[Summarize] No LLM provider configured, using fallback');
		return fallbackSummary(turns);
	}

	const providerMeta = getLLMProvider(providerId);
	if (!providerMeta) {
		return fallbackSummary(turns);
	}

	const config = settingsStore.getProviderConfig(providerId);
	const apiKey = config.apiKey;

	if (providerMeta.requiresApiKey && !apiKey) {
		console.warn('[Summarize] API key missing for provider:', providerId);
		return fallbackSummary(turns);
	}

	// Build transcript
	const transcript = turns
		.slice(-50)
		.map((t) => `${t.role === 'user' ? 'User' : companionName}: ${t.content}`)
		.join('\n\n');

	const userPrompt = `Here is a conversation transcript between a user and their AI companion ${companionName}:\n\n${transcript}\n\nPlease summarize this conversation.`;

	// Call LLM with timeout
	try {
		const result = await Promise.race([
			callLLMForSummary(providerId, model, apiKey || '', config.baseUrl, userPrompt),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Summary generation timed out')), 15000)
			)
		]);

		return result;
	} catch (e) {
		console.warn('[Summarize] LLM summary failed, using fallback:', e);
		return fallbackSummary(turns);
	}
}

async function callLLMForSummary(
	provider: string,
	model: string,
	apiKey: string,
	baseUrl: string | undefined,
	userPrompt: string
): Promise<SessionSummaryResult> {
	return new Promise((resolve, reject) => {
		let fullText = '';
		const meta = getLLMProvider(provider);

		streamChatDirect(
			{
				messages: [{ role: 'user', content: userPrompt }],
				provider: provider as import('$lib/types').LLMProvider,
				model: model || meta?.models?.[0]?.id || '',
				apiKey: apiKey || undefined,
				baseURL: baseUrl || meta?.defaultBaseUrl,
				systemPrompt: SUMMARY_SYSTEM_PROMPT
			},
			(text) => {
				fullText += text;
			},
			(error) => {
				reject(new Error(error));
			},
			() => {
				try {
					const parsed = parseSummaryResponse(fullText);
					resolve(parsed);
				} catch (e) {
					reject(e);
				}
			}
		);
	});
}

function parseSummaryResponse(text: string): SessionSummaryResult {
	// Try to extract JSON from markdown code blocks
	const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
	const jsonText = jsonMatch ? jsonMatch[1] : text;

	// Find the JSON object
	const objMatch = jsonText.match(/\{[\s\S]*\}/);
	if (!objMatch) {
		throw new Error('No JSON object found in response');
	}

	const parsed = JSON.parse(objMatch[0]);

	return {
		summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
		keyTopics: Array.isArray(parsed.keyTopics)
			? parsed.keyTopics.filter((t: unknown): t is string => typeof t === 'string')
			: [],
		emotionalArc: typeof parsed.emotionalArc === 'string' ? parsed.emotionalArc.trim() : ''
	};
}

function fallbackSummary(turns: ConversationTurn[]): SessionSummaryResult {
	const userMessages = turns.filter((t) => t.role === 'user').map((t) => t.content);

	// Extract topics from user messages
	const keyTopics: string[] = [];
	for (const msg of userMessages.slice(-5)) {
		const words = msg.split(/\s+/).filter((w) => w.length > 4);
		if (words.length > 0) keyTopics.push(words[0].toLowerCase());
	}

	return {
		summary: `Conversation with ${turns.length} messages.`,
		keyTopics: [...new Set(keyTopics)].slice(0, 5),
		emotionalArc: 'conversation completed'
	};
}



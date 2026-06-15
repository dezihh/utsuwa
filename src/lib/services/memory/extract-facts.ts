import { browser } from '$app/environment';
import { streamChatDirect } from '$lib/services/chat/client-chat';
import { getLLMProvider } from '$lib/services/providers/registry';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modulesStore } from '$lib/stores/modules.svelte';
import { debugStore } from '$lib/stores/debug.svelte';
import type { NewFact } from '$lib/types/memory';

const EXTRACT_SYSTEM_PROMPT = `Extract factual information about the user from the exchange below.
Output ONLY valid JSON in this exact format:
{"facts": [{"content": "...", "category": "user|relationship|shared_experience", "importance": 50}]}

Rules:
- Extract only clear, persistent facts about the user (preferences, personal info, goals, shared experiences).
- Do NOT extract temporary states ("user seemed tired today").
- importance: 80-100 core personal facts (name, job, family), 50-79 preferences/interests, 20-49 minor details.
- If nothing notable, return {"facts": []}.
- Output ONLY the JSON object. No markdown, no explanations, no code blocks.`;

export interface ExtractedFactsResult {
	facts: NewFact[];
}

function parseExtractResponse(text: string): ExtractedFactsResult {
	const cleaned = text.trim().replace(/^```json\s*|\s*```$/gi, '').trim();
	const parsed = JSON.parse(cleaned);
	if (!Array.isArray(parsed.facts)) {
		throw new Error('Invalid extraction response: facts is not an array');
	}
	const facts: NewFact[] = parsed.facts
		.filter((f: unknown) => typeof (f as { content?: unknown }).content === 'string')
		.map((f: { content: string; category?: string; importance?: number }) => ({
			content: f.content.trim(),
			category: f.category || 'user',
			importance: Math.max(0, Math.min(100, Number(f.importance) || 50)),
			confidence: 0.7
		}));
	return { facts };
}

async function callLLMForFacts(
	provider: string,
	model: string,
	apiKey: string,
	baseUrl: string | undefined,
	userMessage: string,
	assistantResponse: string
): Promise<ExtractedFactsResult> {
	return new Promise((resolve, reject) => {
		let fullText = '';
		const meta = getLLMProvider(provider);

		const prompt = `USER: ${userMessage}\n\nASSISTANT: ${assistantResponse}`;

		streamChatDirect(
			{
				messages: [{ role: 'user', content: prompt }],
				provider: provider as import('$lib/types').LLMProvider,
				model: model || meta?.models?.[0]?.id || '',
				apiKey: apiKey || undefined,
				baseURL: baseUrl || meta?.defaultBaseUrl,
				systemPrompt: EXTRACT_SYSTEM_PROMPT
			},
			(text) => {
				fullText += text;
			},
			(error) => {
				reject(new Error(error));
			},
			() => {
				try {
					const parsed = parseExtractResponse(fullText);
					resolve(parsed);
				} catch (e) {
					reject(e);
				}
			}
		);
	});
}

/**
 * Extract facts from a single user/assistant exchange using the configured LLM.
 * Designed to be cheap and fast enough for small/local models.
 * Returns empty result on failure or timeout.
 */
export async function extractFactsFromLLM(
	userMessage: string,
	assistantResponse: string
): Promise<NewFact[]> {
	if (!browser) return [];

	const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
	const providerId = consciousnessSettings.activeProvider as string;
	const model = consciousnessSettings.activeModel as string;

	if (!providerId) {
		console.warn('[ExtractFacts] No LLM provider configured');
		return [];
	}

	const providerMeta = getLLMProvider(providerId);
	if (!providerMeta) return [];

	const config = settingsStore.getProviderConfig(providerId);
	const apiKey = config.apiKey;

	if (providerMeta.requiresApiKey && !apiKey) {
		console.warn('[ExtractFacts] API key missing for provider:', providerId);
		return [];
	}

	try {
		const result = await Promise.race([
			callLLMForFacts(providerId, model, apiKey || '', config.baseUrl, userMessage, assistantResponse),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Fact extraction timed out')), 8000)
			)
		]);
		debugStore.addLog({
			category: 'memory',
			title: 'Memory Extractor LLM Result',
			content: `Facts returned: ${result.facts.length}\n${result.facts.map((f) => `- ${f.content}`).join('\n') || '(none)'}`
		});
		return result.facts;
	} catch (e) {
		console.warn('[ExtractFacts] LLM fact extraction failed:', e);
		return [];
	}
}

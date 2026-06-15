import { browser } from '$app/environment';
import { streamChatDirect } from '$lib/services/chat/client-chat';
import { getLLMProvider } from '$lib/services/providers/registry';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modulesStore } from '$lib/stores/modules.svelte';
import { embedText, isEmbeddingReady, cosineSimilarity } from '$lib/services/embeddings';
import * as memoryStorage from '$lib/services/storage/memory';
import type { ConversationTurn, NewFact } from '$lib/types/memory';

const RETROACTIVE_TAG_PROMPT = `You are a memory extraction assistant. Analyze this conversation transcript and extract all persistent, meaningful facts about the user.

Output ONLY valid JSON:
{
  "facts": [
    {"content": "fact about the user", "category": "user|relationship|shared_experience", "importance": 0-100}
  ]
}

Rules:
- Only extract persistent facts (preferences, personal info, shared experiences, goals).
- Do NOT extract temporary states ("user seemed tired today").
- Importance 80-100: core personal facts (name, job, family).
- Importance 50-79: preferences, interests, habits.
- Importance 20-49: minor details, one-time mentions.
- Return {"facts": []} if nothing notable.
- Output ONLY the JSON object. No markdown, no explanations, no code blocks.`;

const SHARED_CHARACTER_ID = 'shared';

function determineFactCategory(content: string): 'user' | 'relationship' | 'shared_experience' {
	const lowerContent = content.toLowerCase();
	if (lowerContent.includes('user') || lowerContent.includes('i like') || lowerContent.includes('i love')) {
		return 'user';
	}
	if (lowerContent.includes('we') || lowerContent.includes('together') || lowerContent.includes('shared')) {
		return 'shared_experience';
	}
	return 'relationship';
}

function calculateFactImportance(content: string, sentiment: number = 0): number {
	let importance = 50;
	if (content.length > 50) importance += 10;
	if (content.length > 100) importance += 5;
	const importantKeywords = ['name', 'job', 'work', 'family', 'child', 'parent', 'hobby', 'goal', 'dream', 'favorite'];
	for (const keyword of importantKeywords) {
		if (content.toLowerCase().includes(keyword)) importance += 10;
	}
	importance += Math.abs(sentiment) * 15;
	return Math.max(0, Math.min(100, importance));
}

export interface RetroactiveTagResult {
	saved: number;
	skipped: number;
}

interface ExtractedFact {
	content: string;
	category?: string;
	importance?: number;
}

function parseRetroactiveResponse(text: string): ExtractedFact[] {
	const cleaned = text.trim().replace(/^```json\s*|\s*```$/gi, '').trim();
	const parsed = JSON.parse(cleaned);
	if (!Array.isArray(parsed.facts)) {
		throw new Error('Invalid retroactive response: facts is not an array');
	}
	return parsed.facts.filter((f: ExtractedFact) => typeof f.content === 'string');
}

async function callLLMForRetroactiveTag(
	provider: string,
	model: string,
	apiKey: string,
	baseUrl: string | undefined,
	transcript: string
): Promise<ExtractedFact[]> {
	return new Promise((resolve, reject) => {
		let fullText = '';
		const meta = getLLMProvider(provider);

		streamChatDirect(
			{
				messages: [{ role: 'user', content: transcript }],
				provider: provider as import('$lib/types').LLMProvider,
				model: model || meta?.models?.[0]?.id || '',
				apiKey: apiKey || undefined,
				baseURL: baseUrl || meta?.defaultBaseUrl,
				systemPrompt: RETROACTIVE_TAG_PROMPT
			},
			(text) => {
				fullText += text;
			},
			(error) => {
				reject(new Error(error));
			},
			() => {
				try {
					const parsed = parseRetroactiveResponse(fullText);
					resolve(parsed);
				} catch (e) {
					reject(e);
				}
			}
		);
	});
}

/**
 * Retroactively analyze the current session's transcript for persistent facts.
 * Useful after switching from a small model (that doesn't emit memory tags) to
 * a larger one, or to recover facts from a long conversation.
 */
export async function retroactivelyTagSession(
	turns: ConversationTurn[],
	characterId: string = 'default'
): Promise<RetroactiveTagResult> {
	if (!browser || turns.length === 0) {
		return { saved: 0, skipped: 0 };
	}

	const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
	const providerId = consciousnessSettings.activeProvider as string;
	const model = consciousnessSettings.activeModel as string;

	if (!providerId) {
		console.warn('[RetroactiveTag] No LLM provider configured');
		return { saved: 0, skipped: 0 };
	}

	const providerMeta = getLLMProvider(providerId);
	if (!providerMeta) return { saved: 0, skipped: 0 };

	const config = settingsStore.getProviderConfig(providerId);
	const apiKey = config.apiKey;

	if (providerMeta.requiresApiKey && !apiKey) {
		console.warn('[RetroactiveTag] API key missing for provider:', providerId);
		return { saved: 0, skipped: 0 };
	}

	const transcript = turns
		.slice(-50)
		.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
		.join('\n\n');

	try {
		const extracted = await Promise.race([
			callLLMForRetroactiveTag(providerId, model, apiKey || '', config.baseUrl, transcript),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Retroactive tagging timed out')), 30000)
			)
		]);

		if (extracted.length === 0) {
			return { saved: 0, skipped: 0 };
		}

		const existingFacts = [
			...(await memoryStorage.getFacts({ characterId, limit: 1000 })),
			...(await memoryStorage.getFacts({ characterId: SHARED_CHARACTER_ID, limit: 1000 }))
		];

		let saved = 0;
		let skipped = 0;

		for (const fact of extracted) {
			const content = fact.content.trim();
			if (!content) continue;

			const category = fact.category || determineFactCategory(content);
			const importance =
				fact.importance ?? calculateFactImportance(content);

			let isDuplicate = false;
			if (isEmbeddingReady()) {
				const embedding = await embedText(content);
				if (embedding) {
					isDuplicate = existingFacts.some(
						(f) =>
							f.embedding &&
							f.embedding.length > 0 &&
							cosineSimilarity(embedding, f.embedding) > 0.9
					);
				}
			}

			if (isDuplicate) {
				skipped++;
				continue;
			}

			const targetCharacterId = category === 'user' ? SHARED_CHARACTER_ID : characterId;
			await memoryStorage.saveFact({
				content,
				category: category as 'user' | 'relationship' | 'shared_experience',
				importance,
				confidence: 0.75,
				source: 'retroactive-tagger',
				characterId: targetCharacterId
			});
			saved++;
		}

		return { saved, skipped };
	} catch (e) {
		console.warn('[RetroactiveTag] Failed:', e);
		return { saved: 0, skipped: 0 };
	}
}

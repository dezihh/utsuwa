import { streamChatDirect } from '$lib/services/chat/client-chat';
import { modulesStore } from '$lib/stores/modules.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { getLLMProvider } from '$lib/services/providers/registry';
import type { SessionSummary } from '$lib/types/memory';
import type { PersonalityProfile } from '$lib/types/character';

const EVOLUTION_SYSTEM_PROMPT = `You are a personality evolution analyst for an AI companion.

Analyze the provided conversation sessions and current personality profile.
Identify patterns in how the user interacts with the companion and suggest subtle
communication adaptations that would improve the companion's responses.

Rules:
- Suggest at most 2 adaptations
- Each adaptation should be a short, actionable trait description (1 sentence)
- Focus on communication style, not content knowledge
- Be specific but concise
- Only suggest adaptations if there is clear evidence from the sessions
- If no clear patterns emerge, return an empty array

Respond ONLY with valid JSON in this exact format:
{
  "suggestions": [
    {
      "adaptation": "string describing the trait",
      "reason": "brief justification based on session evidence"
    }
  ]
}`;

export interface EvolutionSuggestion {
	adaptation: string;
	reason: string;
}

export interface EvolutionAnalysisResult {
	suggestions: EvolutionSuggestion[];
}

export async function analyzePersonalityEvolution(
	sessions: SessionSummary[],
	currentPersonality: PersonalityProfile,
	companionName: string = 'Companion'
): Promise<EvolutionSuggestion[]> {
	if (sessions.length === 0) return [];

	const consciousnessSettings = modulesStore.getModuleSettings('consciousness');
	const provider = consciousnessSettings.activeProvider as string;
	const model = consciousnessSettings.activeModel as string;

	if (!provider) {
		console.warn('[Evolution] No consciousness provider configured, skipping LLM analysis');
		return [];
	}

	const providerConfig = settingsStore.getProviderConfig(provider);
	const apiKey = providerConfig.apiKey;
	const providerMeta = getLLMProvider(provider);
	const selectedModel = model || providerMeta?.models?.[0]?.id || '';

	// Build session context
	const sessionContext = sessions
		.map((s, i) => {
			const date = s.endedAt ? new Date(s.endedAt).toLocaleDateString('de-DE') : 'ongoing';
			return `Session ${i + 1} (${date}):\nSummary: ${s.summary || 'No summary'}\nTopics: ${(s.keyTopics || []).join(', ') || 'None'}\nEmotional Arc: ${s.emotionalArc || 'Unknown'}`;
		})
		.join('\n\n');

	const personalityContext = `Current Personality:\n` +
		`- Openness: ${currentPersonality.openness}/100\n` +
		`- Warmth: ${currentPersonality.warmth}/100\n` +
		`- Assertiveness: ${currentPersonality.assertiveness}/100\n` +
		`- Playfulness: ${currentPersonality.playfulness}/100\n` +
		`- Sensitivity: ${currentPersonality.sensitivity}/100\n` +
		`- Likes Teasing: ${currentPersonality.likesTeasing}/100\n` +
		`- Prefers Directness: ${currentPersonality.prefersDirectness}/100\n` +
		`- Romantic Style: ${currentPersonality.romanticStyle}\n` +
		`- Existing Adaptations: ${(currentPersonality.communicationAdaptations || []).join(', ') || 'None'}`;

	const userMessage = `Analyze these conversation sessions for ${companionName} and suggest personality adaptations.\n\n${personalityContext}\n\n---\n\nRecent Sessions:\n${sessionContext}`;

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			console.warn('[Evolution] LLM analysis timed out, returning empty suggestions');
			resolve([]);
		}, 15000);

		let responseText = '';

		streamChatDirect(
			{
				messages: [{ role: 'user', content: userMessage }],
				provider: provider as import('$lib/types').LLMProvider,
				model: selectedModel,
				apiKey: apiKey || undefined,
				baseURL: providerConfig.baseUrl || providerMeta?.defaultBaseUrl,
				systemPrompt: EVOLUTION_SYSTEM_PROMPT
			},
			(text) => {
				responseText += text;
			},
			(error) => {
				clearTimeout(timeout);
				console.error('[Evolution] LLM analysis failed:', error);
				resolve([]);
			},
			() => {
				clearTimeout(timeout);
				try {
					const cleaned = responseText
						.replace(/^```json\s*/i, '')
						.replace(/\s*```$/i, '')
						.trim();
					const result = JSON.parse(cleaned) as EvolutionAnalysisResult;
					if (result.suggestions && Array.isArray(result.suggestions)) {
						resolve(result.suggestions.slice(0, 2));
					} else {
						resolve([]);
					}
				} catch (e) {
					console.error('[Evolution] Failed to parse LLM response:', e);
					resolve([]);
				}
			}
		);
	});
}

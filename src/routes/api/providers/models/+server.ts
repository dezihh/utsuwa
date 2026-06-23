import type { RequestHandler } from './$types';
import type { LLMProvider } from '$lib/types';
import { normalizeOpenAICompatibleBaseURL } from '$lib/services/chat/base-url';

interface ModelInfo {
	id: string;
	name: string;
}

interface FetchModelsResponse {
	models: ModelInfo[];
	error?: string;
}

// Default base URLs per provider (LLM and TTS)
const DEFAULT_BASE_URLS: Partial<Record<LLMProvider | 'elevenlabs' | 'openai-tts', string>> = {
	openai: 'https://api.openai.com/v1',
	anthropic: 'https://api.anthropic.com/v1',
	openrouter: 'https://openrouter.ai/api/v1',
	// TTS providers
	elevenlabs: 'https://api.elevenlabs.io/v1',
	'openai-tts': 'https://api.openai.com/v1'
};

// Model filter patterns - only keep chat-compatible models
const MODEL_FILTERS: Partial<Record<LLMProvider, RegExp>> = {
	openai: /^(gpt-|o1-|o3-|chatgpt-4o-)/,
	anthropic: /^claude-/
};

function isOllamaUrl(url: string): boolean {
	return /localhost:11434|127\.0\.0\.1:11434/.test(url);
}

function filterModels(providerId: LLMProvider, models: ModelInfo[], baseUrl?: string): ModelInfo[] {
	const filter = MODEL_FILTERS[providerId];
	if (!filter) return models;
	// If a custom baseUrl is set for a cloud provider, treat it as a proxy — keep all models
	const defaultUrl = DEFAULT_BASE_URLS[providerId];
	if (baseUrl && defaultUrl && baseUrl.replace(/\/+$/, '') !== defaultUrl.replace(/\/+$/, '')) {
		return models;
	}
	return models.filter((m) => filter.test(m.id));
}

function normalizeModelName(id: string, providerId: LLMProvider): string {
	let name = id;

	// Strip date suffixes from Anthropic models (e.g., -20251101)
	if (providerId === 'anthropic') {
		name = name.replace(/-\d{8}$/, '');
		// Convert version like "opus-4-5" to "opus-4.5"
		name = name.replace(/(opus|sonnet|haiku)-(\d+)-(\d+)$/, '$1-$2.$3');
	}

	// Capitalize and format common patterns
	name = name
		.replace(/-/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.replace(/Gpt/g, 'GPT')
		.replace(/O1/g, 'o1')
		.replace(/O3/g, 'o3');

	return name;
}

async function fetchOpenAICompatibleModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
	const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
	const response = await fetch(`${baseUrl}/models`, { headers });
	if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
	const data = await response.json();
	return (data.data || []).map((m: { id: string }) => ({
		id: m.id,
		name: m.id
	}));
}

async function fetchAnthropicModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
	const response = await fetch(`${baseUrl}/models`, {
		headers: {
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01'
		}
	});
	if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
	const data = await response.json();
	return (data.data || []).map((m: { id: string }) => ({
		id: m.id,
		name: normalizeModelName(m.id, 'anthropic')
	}));
}

async function fetchOllamaModels(baseUrl: string): Promise<ModelInfo[]> {
	const ollamaBase = baseUrl.replace(/\/v1$/, '');
	const response = await fetch(`${ollamaBase}/api/tags`);
	if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
	const data = await response.json();
	return (data.models || []).map((m: { name: string }) => ({
		id: m.name,
		name: m.name
	}));
}

async function fetchOpenRouterModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
	const response = await fetch(`${baseUrl}/models`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'HTTP-Referer': 'https://utsuwa.app',
			'X-Title': 'Utsuwa'
		}
	});
	if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
	const data = await response.json();
	return (data.data as Array<{ id: string; name?: string; architecture?: { modality?: string } }>)
		.filter((m) => {
			// Keep only text-input/text-output (chat) models
			const modality = m.architecture?.modality ?? '';
			return modality === '' || modality.includes('text');
		})
		.map((m) => ({
			id: m.id,
			name: m.name ?? m.id
		}));
}

// TTS Provider fetch functions

async function fetchElevenLabsModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
	const response = await fetch(`${baseUrl}/models`, {
		headers: { 'xi-api-key': apiKey }
	});
	if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
	const models = await response.json();
	// Filter to TTS-capable models only
	return models
		.filter((m: { can_do_text_to_speech?: boolean }) => m.can_do_text_to_speech)
		.map((m: { model_id: string; name: string }) => ({
			id: m.model_id,
			name: m.name
		}));
}

async function fetchOpenAITTSModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
	const response = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
	const data = await response.json();
	// Filter to TTS models only (contain "tts" in name)
	return data.data
		.filter((m: { id: string }) => m.id.includes('tts'))
		.map((m: { id: string }) => ({
			id: m.id,
			name: normalizeModelName(m.id, 'openai')
		}));
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { providerId, apiKey, baseUrl } = await request.json();

		if (!providerId) {
			return Response.json({ models: [], error: 'Provider ID required' } as FetchModelsResponse, {
				status: 400
			});
		}

		const provider = providerId as LLMProvider | 'elevenlabs' | 'openai-tts';
		const effectiveBaseUrl = baseUrl || DEFAULT_BASE_URLS[provider] || '';

		// Remove trailing slash for consistency
		const cleanBaseUrl = effectiveBaseUrl.replace(/\/+$/, '');
		const openAICompatibleBaseUrl = normalizeOpenAICompatibleBaseURL(cleanBaseUrl);

		let models: ModelInfo[] = [];

		switch (provider) {
			case 'openai': {
				if (!apiKey) throw new Error('API key required for OpenAI');
				models = await fetchOpenAICompatibleModels(apiKey, cleanBaseUrl);
				break;
			}
			case 'anthropic': {
				if (!apiKey) throw new Error('API key required for Anthropic');
				models = await fetchAnthropicModels(apiKey, cleanBaseUrl);
				break;
			}
			case 'openrouter': {
				if (!apiKey) throw new Error('API key required for OpenRouter');
				models = await fetchOpenRouterModels(apiKey, cleanBaseUrl);
				break;
			}
			case 'custom-endpoint': {
				if (!cleanBaseUrl) throw new Error('Base URL required for custom endpoint');
				if (isOllamaUrl(cleanBaseUrl)) {
					models = await fetchOllamaModels(cleanBaseUrl);
				} else {
					models = await fetchOpenAICompatibleModels(apiKey || '', cleanBaseUrl);
				}
				break;
			}
			// TTS providers
			case 'elevenlabs': {
				if (!apiKey) throw new Error('API key required for ElevenLabs');
				models = await fetchElevenLabsModels(apiKey, cleanBaseUrl);
				break;
			}
			case 'openai-tts': {
				if (!apiKey) throw new Error('API key required for OpenAI TTS');
				models = await fetchOpenAITTSModels(apiKey, cleanBaseUrl);
				break;
			}
			default:
				return Response.json(
					{ models: [], error: `Unknown provider: ${providerId}` } as FetchModelsResponse,
					{ status: 400 }
				);
		}

		// Filter to chat-compatible models for known LLM providers
		const isLLM = ['openai', 'anthropic', 'openrouter', 'custom-endpoint'].includes(provider);
		const filteredModels = isLLM
			? filterModels(provider as LLMProvider, models, baseUrl)
			: models;

		return Response.json({ models: filteredModels } as FetchModelsResponse);
	} catch (error) {
		console.error('Error fetching models:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return Response.json({ models: [], error: message } as FetchModelsResponse, { status: 500 });
	}
};

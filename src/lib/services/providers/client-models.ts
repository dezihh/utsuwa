import type { LLMProvider } from '$lib/types';
import { getModelsBaseUrl, getLocalProviderConnectionHint } from './local-endpoints';
import { normalizeOpenAICompatibleBaseURL } from '$lib/services/chat/base-url';

interface ModelInfo {
	id: string;
	name: string;
}

const DEFAULT_BASE_URLS: Partial<Record<LLMProvider | 'openai-tts' | 'elevenlabs', string>> = {
	openai: 'https://api.openai.com/v1',
	anthropic: 'https://api.anthropic.com/v1',
	openrouter: 'https://openrouter.ai/api/v1',
	elevenlabs: 'https://api.elevenlabs.io/v1',
	'openai-tts': 'https://api.openai.com/v1'
};

async function fetchElevenLabsModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
	const res = await fetch(`${baseUrl}/models`, {
		headers: { 'xi-api-key': apiKey }
	});
	if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
	const data = await res.json();
	return data
		.filter((m: { can_do_text_to_speech?: boolean }) => m.can_do_text_to_speech)
		.map((m: { model_id: string; name: string }) => ({
			id: m.model_id,
			name: m.name
		}));
}

async function fetchOpenAITTSModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
	const res = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
	const data = await res.json();
	return data.data
		.filter((m: { id: string }) => m.id.includes('tts'))
		.map((m: { id: string }) => ({
			id: m.id,
			name: m.id
		}));
}

const MODEL_FILTERS: Partial<Record<LLMProvider, RegExp>> = {
	openai: /^(gpt-|o1-|o3-|chatgpt-4o-)/,
	anthropic: /^claude-/
};

function isOllamaUrl(url: string): boolean {
	return /localhost:11434|127\.0\.0\.1:11434/.test(url);
}

function normalizeModelName(id: string, providerId: LLMProvider): string {
	let name = id;
	if (providerId === 'anthropic') {
		name = name.replace(/-\d{8}$/, '');
		name = name.replace(/(opus|sonnet|haiku)-(\d+)-(\d+)$/, '$1-$2.$3');
	}
	name = name
		.replace(/-/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.replace(/Gpt/g, 'GPT')
		.replace(/O1/g, 'o1')
		.replace(/O3/g, 'o3');
	return name;
}

function getCurrentSiteOrigin(): string | undefined {
	return typeof window !== 'undefined' ? window.location.origin : undefined;
}

async function fetchOpenAICompatibleModels(
	baseUrl: string,
	apiKey?: string
): Promise<ModelInfo[]> {
	const headers: Record<string, string> = {};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	const res = await fetch(`${baseUrl}/models`, { headers });
	if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
	const data = await res.json();
	return (data.data || []).map((m: { id: string }) => ({
		id: m.id,
		name: m.id
	}));
}

async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
	const res = await fetch(`${baseUrl}/models`, {
		headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
	});
	if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
	const data = await res.json();
	return (data.data || []).map((m: { id: string }) => ({
		id: m.id,
		name: normalizeModelName(m.id, 'anthropic')
	}));
}

async function fetchOllamaModels(baseUrl: string): Promise<ModelInfo[]> {
	const ollamaBase = baseUrl.replace(/\/v1$/, '');
	const res = await fetch(`${ollamaBase}/api/tags`);
	if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
	const data = await res.json();
	return (data.models || []).map((m: { name: string }) => ({
		id: m.name,
		name: m.name
	}));
}

/**
 * Resolve provider wildcards (e.g. "openrouter/*") into concrete models.
 */
async function resolveWildcards(models: ModelInfo[]): Promise<ModelInfo[]> {
	const wildcardIds = models.map((m) => m.id).filter((id) => id.includes('*'));
	if (wildcardIds.length === 0) return models;

	const resolved: ModelInfo[] = [];
	const existingIds = new Set(models.map((m) => m.id));

	for (const id of wildcardIds) {
		const [providerPrefix] = id.split('*');
		const provider = providerPrefix.replace(/\/$/, '');

		if (provider === 'openrouter') {
			try {
				const res = await fetch('https://openrouter.ai/api/v1/models');
				if (res.ok) {
					const data = await res.json();
					const openRouterModels = (data.data as Array<{ id: string; architecture?: { modality?: string } }>)
						.filter((m) => {
							const modality = m.architecture?.modality ?? '';
							return modality === '' || modality.includes('text');
						})
						.map((m) => ({
							id: `openrouter/${m.id}`,
							name: `openrouter/${m.id}`
						}))
						.filter((m) => !existingIds.has(m.id));
					resolved.push(...openRouterModels);
				}
			} catch (err) {
				console.warn('[fetchModelsDirect] Failed to resolve openrouter wildcard:', err);
			}
		}
	}

	return [...models.filter((m) => !m.id.includes('*')), ...resolved];
}

/**
 * Fetch models directly from provider APIs.
 * Used in Tauri builds where SvelteKit server routes aren't available.
 */
export async function fetchModelsDirect(
	providerId: string,
	apiKey?: string,
	baseUrl?: string
): Promise<{ models: ModelInfo[]; error?: string }> {
	const provider = providerId as LLMProvider | 'elevenlabs' | 'openai-tts';
	const cleanBaseUrl =
		provider === 'custom-endpoint'
			? getModelsBaseUrl(providerId, baseUrl)
			: normalizeOpenAICompatibleBaseURL(
					baseUrl || DEFAULT_BASE_URLS[provider] || ''
				)?.replace(/\/+$/, '') ||
				(baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, '');

	try {
		let models: ModelInfo[] = [];

		switch (provider) {
			case 'openai':
			case 'openrouter': {
				if (!apiKey) throw new Error('API key required');
				models = await fetchOpenAICompatibleModels(cleanBaseUrl, apiKey);
				break;
			}
			case 'anthropic': {
				if (!apiKey) throw new Error('API key required');
				models = await fetchAnthropicModels(cleanBaseUrl, apiKey);
				break;
			}
			case 'custom-endpoint': {
				if (!cleanBaseUrl) throw new Error('Base URL required for custom endpoint');
				if (isOllamaUrl(cleanBaseUrl)) {
					models = await fetchOllamaModels(cleanBaseUrl);
				} else {
					models = await fetchOpenAICompatibleModels(cleanBaseUrl, apiKey);
					models = await resolveWildcards(models);
				}
				break;
			}
			case 'elevenlabs': {
				if (!apiKey) throw new Error('API key required for ElevenLabs');
				models = await fetchElevenLabsModels(cleanBaseUrl, apiKey);
				break;
			}
			case 'openai-tts': {
				if (!apiKey) throw new Error('API key required for OpenAI TTS');
				models = await fetchOpenAITTSModels(cleanBaseUrl, apiKey);
				break;
			}
			default:
				return { models: [], error: `Unknown provider: ${providerId}` };
		}

		const filter = MODEL_FILTERS[provider as LLMProvider];
		const filtered = filter ? models.filter((m) => filter.test(m.id)) : models;
		return { models: filtered };
	} catch (error) {
		const message =
			provider === 'custom-endpoint'
				? getLocalProviderConnectionHint(providerId, cleanBaseUrl, getCurrentSiteOrigin())
				: error instanceof Error
					? error.message
					: 'Unknown error';
		return { models: [], error: message };
	}
}

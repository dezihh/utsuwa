import type { LLMProvider } from '$lib/types';

function ensureTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

/**
 * Ollama and LM Studio accept bare host URLs for model discovery, but chat
 * completions need the OpenAI-compatible /v1 prefix.
 */
export function normalizeChatBaseURL(provider: LLMProvider, baseURL?: string): string | undefined {
	if (!baseURL) return baseURL;

	const cleanBaseURL = ensureTrailingSlash(baseURL);
	// Custom endpoints (Ollama, LM Studio, llama.cpp, self-hosted proxies) need the
	// OpenAI-compatible /v1 prefix for chat completions.
	if (provider === 'custom-endpoint') {
		return cleanBaseURL.endsWith('/v1') ? cleanBaseURL : `${cleanBaseURL}/v1`;
	}

	return cleanBaseURL;
}

export function normalizeOpenAICompatibleBaseURL(baseURL?: string): string | undefined {
	if (!baseURL) return baseURL;

	const cleanBaseURL = ensureTrailingSlash(baseURL);
	return cleanBaseURL.endsWith('/v1') ? cleanBaseURL : `${cleanBaseURL}/v1`;
}

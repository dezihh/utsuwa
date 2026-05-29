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
	if (provider === 'ollama' || provider === 'lmstudio') {
		return cleanBaseURL.endsWith('/v1') ? cleanBaseURL : `${cleanBaseURL}/v1`;
	}

	return cleanBaseURL;
}

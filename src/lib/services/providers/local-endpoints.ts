const DEFAULT_BASE_URLS: Record<string, string> = {
	ollama: 'http://localhost:11434/v1',
	lmstudio: 'http://localhost:1234/v1',
	llamacpp: 'http://localhost:8080/v1'
};

const OLLAMA_ORIGINS_DOC_URL =
	'https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama';

function trimTrailingSlashes(url: string): string {
	return url.replace(/\/+$/, '');
}

function ensureOpenAIPath(url: string): string {
	const cleanUrl = trimTrailingSlashes(url);
	return cleanUrl.endsWith('/v1') ? cleanUrl : `${cleanUrl}/v1`;
}

export function isLocalLLMProvider(providerId: string): boolean {
	// Legacy local provider IDs are migrated to custom-endpoint.
	return providerId === 'custom-endpoint';
}

export function getModelsBaseUrl(providerId: string, baseUrl?: string): string {
	if (providerId === 'custom-endpoint') {
		return trimTrailingSlashes(baseUrl || '');
	}

	const cleanUrl = trimTrailingSlashes(baseUrl || DEFAULT_BASE_URLS[providerId] || '');

	if (providerId === 'ollama') {
		return cleanUrl.replace(/\/v1$/, '');
	}

	if (providerId === 'lmstudio') {
		return ensureOpenAIPath(cleanUrl);
	}

	return cleanUrl;
}

export function getChatBaseUrl(providerId: string, baseUrl?: string): string {
	if (providerId === 'custom-endpoint') {
		return trimTrailingSlashes(baseUrl || '');
	}

	const cleanUrl = trimTrailingSlashes(baseUrl || DEFAULT_BASE_URLS[providerId] || '');

	if (providerId === 'ollama' || providerId === 'lmstudio' || providerId === 'llamacpp') {
		return ensureOpenAIPath(cleanUrl);
	}

	return cleanUrl;
}

export function getLocalProviderConnectionHint(
	providerId: string,
	baseUrl?: string,
	siteOrigin?: string
): string {
	if (providerId !== 'custom-endpoint') {
		return `Legacy provider "${providerId}" is no longer supported. Please switch to Custom Endpoint.`;
	}

	const chatBaseUrl = getChatBaseUrl(providerId, baseUrl);

	if (chatBaseUrl.includes('localhost:11434') || chatBaseUrl.includes('127.0.0.1:11434')) {
		const originHint = siteOrigin
			? ` For this site, restart Ollama with OLLAMA_ORIGINS="${siteOrigin}" ollama serve.`
			: ` Set OLLAMA_ORIGINS to this site's origin before starting Ollama.`;
		return `Could not reach Ollama at ${chatBaseUrl}. Make sure Ollama is running with "ollama serve", the model is pulled with "ollama pull <model>", and browser users allow this site's origin with OLLAMA_ORIGINS.${originHint} More help: ${OLLAMA_ORIGINS_DOC_URL}`;
	}

	if (chatBaseUrl.includes('localhost:1234') || chatBaseUrl.includes('127.0.0.1:1234')) {
		return `Could not reach LM Studio at ${chatBaseUrl}. Open LM Studio, go to the Developer or Server tab, load a model, and click Start Server.`;
	}

	if (chatBaseUrl.includes('localhost:8080') || chatBaseUrl.includes('127.0.0.1:8080')) {
		return `Could not reach llama.cpp at ${chatBaseUrl}. Make sure the server is running with: llama-server --model <model.gguf> --port 8080`;
	}

	return `Could not reach custom endpoint at ${chatBaseUrl}. Make sure the server is running and reachable from this device.`;
}

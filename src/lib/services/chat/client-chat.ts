import type { LLMProvider } from '$lib/types';
import { getChatBaseUrl, getLocalProviderConnectionHint } from '$lib/services/providers/local-endpoints';
import { normalizeChatBaseURL } from './base-url';
import { PROVIDER_BASE_URLS } from '$lib/services/providers/base-urls';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ChatOptions {
	messages: ChatMessage[];
	provider: LLMProvider;
	model: string;
	apiKey?: string;
	baseURL?: string;
	systemPrompt: string;
	llmTemperature?: number;
	llmTopP?: number;
	llmMaxTokens?: number;
	llmPresencePenalty?: number;
	llmFrequencyPenalty?: number;
}

function getCurrentSiteOrigin(): string | undefined {
	return typeof window !== 'undefined' ? window.location.origin : undefined;
}

function getProviderBaseURL(provider: LLMProvider, baseURL?: string): string | undefined {
	if (provider === 'custom-endpoint') {
		const url = getChatBaseUrl(provider, baseURL);
		return url ? normalizeChatBaseURL(provider, url) : undefined;
	}
	const fallback = PROVIDER_BASE_URLS[provider];
	if (!fallback) {
		return undefined;
	}
	return normalizeChatBaseURL(provider, baseURL || fallback);
}

function buildHeaders(provider: LLMProvider, apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (provider === 'anthropic') {
		headers['x-api-key'] = apiKey || '';
		headers['anthropic-version'] = '2023-06-01';
		headers['anthropic-dangerous-direct-browser-access'] = 'true';
	} else if (provider === 'openrouter') {
		headers['HTTP-Referer'] = 'https://utsuwa.app';
		headers['X-Title'] = 'Utsuwa';
	}

	if (apiKey && provider !== 'anthropic') {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	return headers;
}

/**
 * Stream chat completions directly from provider APIs.
 * Used for local providers and Tauri builds where SvelteKit server routes aren't available.
 */
export async function streamChatDirect(
	options: ChatOptions,
	onChunk: (text: string) => void,
	onError: (error: string) => void,
	onDone: () => void,
	signal?: AbortSignal
): Promise<void> {
	const {
		messages,
		provider,
		model,
		apiKey,
		baseURL,
		systemPrompt,
		llmTemperature,
		llmTopP,
		llmMaxTokens,
		llmPresencePenalty,
		llmFrequencyPenalty
	} = options;

	const isCustomEndpoint = provider === 'custom-endpoint';
	const requiresKey = provider !== 'custom-endpoint';
	if (!apiKey && requiresKey) {
		onError('API key required');
		return;
	}

	const providerBaseURL = getProviderBaseURL(provider, baseURL);
	if (!providerBaseURL) {
		onError(`Base URL required for ${provider}`);
		return;
	}

	const extraSystem = messages
		.filter((m) => m.role === 'system')
		.map((m) => m.content)
		.join('\n\n');
	const combinedSystem = extraSystem ? `${systemPrompt}\n\n${extraSystem}` : systemPrompt;

	const messagesWithSystem: ChatMessage[] = [
		{ role: 'system', content: systemPrompt },
		...messages
	];

	const headers = buildHeaders(provider, apiKey);

	// Build request body with optional sampling parameters.
	const anthropicBody: Record<string, unknown> = {
		model,
		max_tokens: llmMaxTokens ?? 4096,
		system: combinedSystem,
		messages: messages.filter((m) => m.role !== 'system'),
		stream: true
	};
	if (llmTemperature !== undefined) anthropicBody.temperature = llmTemperature;
	if (llmTopP !== undefined) anthropicBody.top_p = llmTopP;

	const openAICompatibleBody: Record<string, unknown> = {
		model,
		messages: messagesWithSystem,
		stream: true
	};
	if (llmTemperature !== undefined) openAICompatibleBody.temperature = llmTemperature;
	if (llmTopP !== undefined) openAICompatibleBody.top_p = llmTopP;
	if (llmMaxTokens !== undefined) openAICompatibleBody.max_tokens = llmMaxTokens;
	if (llmPresencePenalty !== undefined) openAICompatibleBody.presence_penalty = llmPresencePenalty;
	if (llmFrequencyPenalty !== undefined) openAICompatibleBody.frequency_penalty = llmFrequencyPenalty;

	// Anthropic uses a different request format
	const body =
		provider === 'anthropic'
			? JSON.stringify(anthropicBody)
			: JSON.stringify(openAICompatibleBody);

	const url =
		provider === 'anthropic'
			? `${providerBaseURL.replace(/\/+$/, '')}/messages`
			: `${providerBaseURL.replace(/\/+$/, '')}/chat/completions`;

	try {
		const response = await fetch(url, { method: 'POST', headers, body, signal });

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			let msg =
				(errorData as { error?: { message?: string } })?.error?.message ||
				`Provider error (${response.status})`;

			// Surface deprecated/unavailable models as an actionable user message.
			if (/no longer available|has been deprecated|has been shut down|is not available/i.test(msg)) {
				msg = `The selected model is no longer available. Please choose a different model in Settings > Character > AI Services. (${msg})`;
			} else if (isCustomEndpoint && response.status === 404) {
				msg = `${msg}. Pull or select an installed model.`;
			}

			onError(msg);
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			onError('No response body');
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed === 'data: [DONE]') continue;
				if (!trimmed.startsWith('data: ')) continue;

				try {
					const json = JSON.parse(trimmed.slice(6));

					// OpenAI-compatible format
					if (json.choices?.[0]?.delta?.content) {
						onChunk(json.choices[0].delta.content);
					}
					// Anthropic format
					else if (json.type === 'content_block_delta' && json.delta?.text) {
						onChunk(json.delta.text);
					}
				} catch {
					// Skip malformed JSON lines
				}
			}
		}

		onDone();
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			// Stream was cancelled by the caller — don't report as error
			return;
		}
		const msg = err instanceof Error ? err.message : 'Failed to connect to provider';
		if (isCustomEndpoint && err instanceof TypeError) {
			const isLocalhost = baseURL ? /localhost|127\.0\.0\.1/.test(baseURL) : false;
			if (isLocalhost) {
				onError(`${msg}. If Utsuwa is running inside Docker and LiteLLM/your proxy is on the host, use http://host.docker.internal:${baseURL?.match(/:(\d+)/)?.[1] ?? '4000'} instead of localhost.`);
			} else {
				onError(getLocalProviderConnectionHint(provider, baseURL, getCurrentSiteOrigin()));
			}
		} else {
			onError(msg);
		}
	}
}

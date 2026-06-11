import type { LLMProvider } from '$lib/types';
import {
	getChatBaseUrl,
	getLocalProviderConnectionHint,
	isLocalLLMProvider
} from '$lib/services/providers/local-endpoints';
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
}

function getCurrentSiteOrigin(): string | undefined {
	return typeof window !== 'undefined' ? window.location.origin : undefined;
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
	const { messages, provider, model, apiKey, baseURL, systemPrompt } = options;

	const isLocal = isLocalLLMProvider(provider);
	if (!apiKey && !isLocal) {
		onError('API key required');
		return;
	}

	const providerBaseURL = isLocal
		? getChatBaseUrl(provider, baseURL)
		: normalizeChatBaseURL(provider, baseURL || PROVIDER_BASE_URLS[provider]);
	if (!providerBaseURL) {
		onError(`Unknown provider: ${provider}`);
		return;
	}

	const messagesWithSystem: ChatMessage[] = [
		{ role: 'system', content: systemPrompt },
		...messages
	];

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (provider === 'anthropic') {
		headers['x-api-key'] = apiKey || '';
		headers['anthropic-version'] = '2023-06-01';
		headers['anthropic-dangerous-direct-browser-access'] = 'true';
	} else if (apiKey) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	// Anthropic uses a different request format
	const body =
		provider === 'anthropic'
			? JSON.stringify({
					model,
					max_tokens: 4096,
					system: systemPrompt,
					messages: messages.filter((m) => m.role !== 'system'),
					stream: true
				})
			: JSON.stringify({
					model,
					messages: messagesWithSystem,
					stream: true
				});

	const url =
		provider === 'anthropic'
			? `${providerBaseURL.replace(/\/+$/, '')}/messages`
			: `${providerBaseURL.replace(/\/+$/, '')}/chat/completions`;

	try {
		const response = await fetch(url, { method: 'POST', headers, body, signal });

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			const msg =
				(errorData as { error?: { message?: string } })?.error?.message ||
				`Provider error (${response.status})`;
			onError(isLocal && response.status === 404 ? `${msg}. Pull or select an installed model.` : msg);
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
		const rawMessage = err instanceof Error ? err.message : 'Failed to connect to provider';
		const msg = isLocal
			? getLocalProviderConnectionHint(provider, providerBaseURL, getCurrentSiteOrigin())
			: rawMessage;
		onError(msg);
	}
}

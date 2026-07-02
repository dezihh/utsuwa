import type { LLMProvider } from '$lib/types';
import {
	getChatBaseUrl,
	getLocalProviderConnectionHint
} from '$lib/services/providers/local-endpoints';
import { normalizeChatBaseURL } from './base-url';
import { PROVIDER_BASE_URLS } from '$lib/services/providers/base-urls';
import { parseSSEStream } from './stream-parser';
import { type MessageContent, contentToText, toAnthropicContent, toOpenAIContent } from './content';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: MessageContent;
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
		.map((m) => contentToText(m.content))
		.join('\n\n');
	const combinedSystem = extraSystem ? `${systemPrompt}\n\n${extraSystem}` : systemPrompt;

	const messagesWithSystem: ChatMessage[] = [
		{ role: 'system', content: systemPrompt },
		...messages
	];

	const headers = buildHeaders(provider, apiKey);

	// Anthropic uses a different request format, and each provider wants images
	// wrapped its own way (image_url data URLs vs base64 source blocks).
	const body =
		provider === 'anthropic'
			? JSON.stringify({
					model,
					max_tokens: llmMaxTokens ?? 4096,
					system: combinedSystem,
					messages: messages
						.filter((m) => m.role !== 'system')
						.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
					stream: true,
					...(llmTemperature !== undefined ? { temperature: llmTemperature } : {}),
					...(llmTopP !== undefined ? { top_p: llmTopP } : {})
				})
			: JSON.stringify({
					model,
					messages: messagesWithSystem.map((m) => ({
						role: m.role,
						content: toOpenAIContent(m.content)
					})),
					stream: true,
					...(llmTemperature !== undefined ? { temperature: llmTemperature } : {}),
					...(llmTopP !== undefined ? { top_p: llmTopP } : {}),
					...(llmMaxTokens !== undefined ? { max_tokens: llmMaxTokens } : {}),
					...(llmPresencePenalty !== undefined ? { presence_penalty: llmPresencePenalty } : {}),
					...(llmFrequencyPenalty !== undefined ? { frequency_penalty: llmFrequencyPenalty } : {})
				});

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
				msg = `The selected model is no longer available. Please choose a different model in Settings > LLM Model. (${msg})`;
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

		await parseSSEStream(reader, {
			onChunk,
			onDone,
			onError,
			format: provider === 'anthropic' ? 'anthropic' : 'openai'
		});
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

interface ExtractStateUpdatesOptions {
	provider: LLMProvider;
	model: string;
	apiKey?: string;
	baseURL?: string;
	system: string;
	userMessage: string;
	reply: string;
	llmTemperature?: number;
	llmTopP?: number;
	llmMaxTokens?: number;
}

/**
 * Dedicated forced-JSON extraction call for mood and memory updates.
 * Used when the main chat model did not emit a usable state block inline.
 */
export async function extractStateUpdates(
	options: ExtractStateUpdatesOptions,
	signal?: AbortSignal
): Promise<string | null> {
	const { provider, model, apiKey, baseURL, system, userMessage, reply } = options;

	return new Promise((resolve, reject) => {
		let fullText = '';
		let settled = false;

		streamChatDirect(
			{
				messages: [
					{ role: 'user', content: `USER: ${userMessage}\n\nASSISTANT: ${reply}` }
				],
				provider,
				model,
				apiKey,
				baseURL,
				systemPrompt: system,
				llmTemperature: options.llmTemperature ?? 0.3,
				llmTopP: options.llmTopP ?? 0.9,
				llmMaxTokens: options.llmMaxTokens ?? 512
			},
			(text) => {
				fullText += text;
			},
			(error) => {
				if (settled) return;
				settled = true;
				reject(new Error(error));
			},
			() => {
				if (settled) return;
				settled = true;
				resolve(fullText.trim() || null);
			},
			signal
		);
	});
}

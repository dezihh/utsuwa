import { streamText, type StreamTextOptions } from '@xsai/stream-text';
import type { RequestHandler } from './$types';
import type { LLMProvider } from '$lib/types';
import { getChatBaseUrl } from '$lib/services/providers/local-endpoints';
import { normalizeChatBaseURL } from '$lib/services/chat/base-url';
import { PROVIDER_BASE_URLS } from '$lib/services/providers/base-urls';

function formatCustomEndpointError(err: unknown, baseURL?: string): string {
	const message = err instanceof Error ? err.message : 'Failed to connect to provider';
	if (!baseURL) return message;

	const isLocalhost = /localhost|127\.0\.0\.1/.test(baseURL);
	if (isLocalhost) {
		return `${message}. If Utsuwa is running inside Docker and LiteLLM/your proxy is on the host, use http://host.docker.internal:${baseURL.match(/:(\d+)/)?.[1] ?? '4000'} instead of localhost.`;
	}
	return message;
}

async function streamOpenAICompatibleChat(
	url: string,
	model: string,
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
	apiKey?: string,
	options?: {
		llmTemperature?: number;
		llmTopP?: number;
		llmMaxTokens?: number;
		llmPresencePenalty?: number;
		llmFrequencyPenalty?: number;
	}
): Promise<Response> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const body: Record<string, unknown> = { model, messages, stream: true };
	if (options?.llmTemperature !== undefined) body.temperature = options.llmTemperature;
	if (options?.llmTopP !== undefined) body.top_p = options.llmTopP;
	if (options?.llmMaxTokens !== undefined) body.max_tokens = options.llmMaxTokens;
	if (options?.llmPresencePenalty !== undefined) body.presence_penalty = options.llmPresencePenalty;
	if (options?.llmFrequencyPenalty !== undefined) body.frequency_penalty = options.llmFrequencyPenalty;

	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: formatCustomEndpointError(err, url) }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		let msg =
			(errorData as { error?: { message?: string } })?.error?.message ||
			`Provider error (${response.status})`;

		// Surface deprecated/unavailable models as an actionable user message.
		if (/no longer available|has been deprecated|has been shut down|is not available/i.test(msg)) {
			msg = `The selected model is no longer available. Please choose a different model in Settings > Character > AI Services. (${msg})`;
		}

		return new Response(JSON.stringify({ error: msg }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const reader = response.body?.getReader();
	if (!reader) {
		return new Response(JSON.stringify({ error: 'No response body' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const stream = new ReadableStream({
		async start(controller) {
			let buffer = '';

			try {
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
							const text = json.choices?.[0]?.delta?.content;
							if (text) {
								controller.enqueue(encoder.encode(`0:${JSON.stringify(text)}\n`));
							}
						} catch {
							// Ignore malformed chunks.
						}
					}
				}

				controller.close();
			} catch (error) {
				console.error('Stream error:', error);
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				controller.enqueue(encoder.encode(`e:${JSON.stringify({ error: errorMessage })}\n`));
				controller.close();
			} finally {
				reader.releaseLock();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
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
	} = body;

	const llmOptions = {
		llmTemperature,
		llmTopP,
		llmMaxTokens,
		llmPresencePenalty,
		llmFrequencyPenalty
	};

	const typedProvider = provider as LLMProvider;
	const isCustomEndpoint = typedProvider === 'custom-endpoint';
	const requiresApiKey = typedProvider !== 'custom-endpoint';

	// API key required for all providers except custom endpoint (local or keyless OpenAI-compatible APIs)
	if (!apiKey && requiresApiKey) {
		return new Response(JSON.stringify({ error: 'API key required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Model is required - no more static fallbacks
	if (!model) {
		return new Response(JSON.stringify({ error: 'Model is required. Please select a model from the list.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// Configure based on provider
		let providerBaseURL = baseURL;
		const headers: Record<string, string> = {};

		// Handle special provider configurations
		if (typedProvider === 'anthropic') {
			providerBaseURL = providerBaseURL || PROVIDER_BASE_URLS.anthropic;
			headers['anthropic-dangerous-direct-browser-access'] = 'true';
		} else if (typedProvider === 'openrouter') {
			providerBaseURL = providerBaseURL || PROVIDER_BASE_URLS.openrouter;
			headers['HTTP-Referer'] = 'https://utsuwa.app';
			headers['X-Title'] = 'Utsuwa';
		} else if (isCustomEndpoint) {
			providerBaseURL = getChatBaseUrl(typedProvider, providerBaseURL);
		} else {
			// Use default base URL for provider
			providerBaseURL = providerBaseURL || PROVIDER_BASE_URLS[typedProvider];
		}

		providerBaseURL = normalizeChatBaseURL(typedProvider, providerBaseURL);

		// Add system message (use provided systemPrompt or default)
		const defaultSystemPrompt =
			'You are a friendly AI assistant displayed as a VRM avatar named Utsuwa. Keep responses conversational, but expand naturally when the user asks for a story, explanation, or detailed answer.';
		const messagesWithSystem = [
			{
				role: 'system' as const,
				content: systemPrompt || defaultSystemPrompt
			},
			...messages
		];

		if (isCustomEndpoint) {
			const chatURL = `${providerBaseURL.replace(/\/+$/, '')}/chat/completions`;
			return await streamOpenAICompatibleChat(chatURL, model, messagesWithSystem, apiKey || undefined, llmOptions);
		}

		let result;
		try {
			const xsaiOptions: StreamTextOptions & Record<string, unknown> = {
				apiKey: apiKey || 'not-needed',
				baseURL: providerBaseURL,
				model,
				messages: messagesWithSystem,
				headers
			};
			if (llmTemperature !== undefined) xsaiOptions.temperature = llmTemperature;
			if (llmTopP !== undefined) xsaiOptions.topP = llmTopP;
			if (llmMaxTokens !== undefined) xsaiOptions.maxTokens = llmMaxTokens;
			if (llmPresencePenalty !== undefined) xsaiOptions.presencePenalty = llmPresencePenalty;
			if (llmFrequencyPenalty !== undefined) xsaiOptions.frequencyPenalty = llmFrequencyPenalty;

			result = streamText(xsaiOptions);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to connect to provider';
			return new Response(JSON.stringify({ error: msg }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Suppress background promise/stream rejections so they don't crash Node.
		// xsai rejects every promise and errors every stream when the provider request fails.
		// Only silence AbortErrors; log genuine unexpected errors so they don't go unnoticed.
		const quietCatch = (err: unknown) => {
			if (err instanceof Error && err.name !== 'AbortError') {
				console.warn('[Chat API] xsai background promise/stream error:', err.message);
			}
		};
		result.messages?.catch?.(quietCatch);
		result.steps?.catch?.(quietCatch);
		result.totalUsage?.catch?.(quietCatch);
		result.usage?.catch?.(quietCatch);
		// Consume errored ReadableStreams so they don't become unhandled
		result.fullStream?.getReader().read().catch(quietCatch);
		result.reasoningTextStream?.getReader().read().catch(quietCatch);

		const { textStream } = result;

		// Create a readable stream for SSE
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				let reader;
				try {
					reader = textStream.getReader();
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to start stream';
					controller.enqueue(encoder.encode(`e:${JSON.stringify({ error: msg })}\n`));
					controller.close();
					return;
				}

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						const data = `0:${JSON.stringify(value)}\n`;
						controller.enqueue(encoder.encode(data));
					}
					controller.close();
				} catch (error) {
					console.error('Stream error:', error);
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					controller.enqueue(encoder.encode(`e:${JSON.stringify({ error: errorMessage })}\n`));
					controller.close();
				} finally {
					reader.releaseLock();
				}
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	} catch (error) {
		console.error('Chat API error:', error);
		const typedProvider = provider as LLMProvider;
		const baseURL = body?.baseURL;
		const errorMessage =
			typedProvider === 'custom-endpoint'
				? formatCustomEndpointError(error, baseURL)
				: error instanceof Error
					? error.message
					: 'Unknown error';
		return new Response(JSON.stringify({ error: errorMessage }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

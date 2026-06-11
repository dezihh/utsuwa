import { streamText } from '@xsai/stream-text';
import type { RequestHandler } from './$types';
import type { LLMProvider } from '$lib/types';
import { getChatBaseUrl, isLocalLLMProvider } from '$lib/services/providers/local-endpoints';
import { normalizeChatBaseURL } from '$lib/services/chat/base-url';
import { PROVIDER_BASE_URLS } from '$lib/services/providers/base-urls';

async function streamOpenAICompatibleChat(
	url: string,
	model: string,
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
	apiKey?: string
): Promise<Response> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ model, messages, stream: true })
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		const msg =
			(errorData as { error?: { message?: string } })?.error?.message ||
			`Provider error (${response.status})`;
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
	const { messages, provider, model, apiKey, baseURL, systemPrompt } = await request.json();

	const typedProvider = provider as LLMProvider;

	// Local providers don't require API keys
	const isLocalProvider = isLocalLLMProvider(typedProvider);
	if (!apiKey && !isLocalProvider) {
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
		} else if (isLocalProvider) {
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

		if (isLocalProvider) {
			const chatURL = `${providerBaseURL.replace(/\/+$/, '')}/chat/completions`;
			return await streamOpenAICompatibleChat(chatURL, model, messagesWithSystem, apiKey || undefined);
		}

		let result;
		try {
			result = streamText({
				apiKey: apiKey || 'not-needed',
				baseURL: providerBaseURL,
				model,
				messages: messagesWithSystem,
				headers
			});
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
		return new Response(
			JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};

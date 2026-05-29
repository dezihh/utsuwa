import { streamText } from '@xsai/stream-text';
import type { RequestHandler } from './$types';
import type { LLMProvider } from '$lib/types';
import { getChatBaseUrl } from '$lib/services/providers/local-endpoints';
import { normalizeChatBaseURL } from '$lib/services/chat/base-url';

// Provider base URLs
const PROVIDER_BASE_URLS: Partial<Record<LLMProvider, string>> = {
	// Cloud
	openai: 'https://api.openai.com/v1/',
	anthropic: 'https://api.anthropic.com/v1/',
	google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
	deepseek: 'https://api.deepseek.com/',
	xai: 'https://api.x.ai/v1/',
	// Local
	ollama: 'http://localhost:11434/v1/',
	lmstudio: 'http://localhost:1234/v1/',
	llamacpp: 'http://localhost:8080/v1/',
};

// Providers that don't require API keys
const LOCAL_PROVIDERS: LLMProvider[] = ['ollama', 'lmstudio', 'llamacpp'];

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
	const isLocalProvider = LOCAL_PROVIDERS.includes(typedProvider);
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
		} else if (isLocalProvider) {
			providerBaseURL = getChatBaseUrl(typedProvider, providerBaseURL);
		} else {
			// Use default base URL for provider
			providerBaseURL = providerBaseURL || PROVIDER_BASE_URLS[typedProvider];
		}

		providerBaseURL = normalizeChatBaseURL(typedProvider, providerBaseURL);

		// Add system message (use provided systemPrompt or default)
		const defaultSystemPrompt =
			'You are a friendly AI assistant displayed as a VRM avatar named Utsuwa. Keep responses conversational and relatively concise.';
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

		// Suppress ALL background promise/stream rejections so they don't crash Node.
		// xsai rejects every promise and errors every stream when the provider request fails.
		const silentCatch = () => {};
		result.messages?.catch?.(silentCatch);
		result.steps?.catch?.(silentCatch);
		result.totalUsage?.catch?.(silentCatch);
		result.usage?.catch?.(silentCatch);
		// Consume errored ReadableStreams so they don't become unhandled
		result.fullStream?.getReader().read().catch(silentCatch);
		result.reasoningTextStream?.getReader().read().catch(silentCatch);

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

export interface SSEParserOptions {
	onChunk: (text: string) => void;
	onDone?: () => void;
	onError?: (error: string) => void;
	format?: 'openai' | 'anthropic';
}

export async function parseSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	options: SSEParserOptions
): Promise<void> {
	const decoder = new TextDecoder();
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

					if (options.format === 'anthropic') {
						if (json.type === 'content_block_delta' && json.delta?.text) {
							options.onChunk(json.delta.text);
						}
					} else {
						if (json.choices?.[0]?.delta?.content) {
							options.onChunk(json.choices[0].delta.content);
						}
					}
				} catch {
					// Skip malformed JSON lines
				}
			}
		}

		options.onDone?.();
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') return;
		const msg = err instanceof Error ? err.message : 'Stream read error';
		options.onError?.(msg);
	}
}

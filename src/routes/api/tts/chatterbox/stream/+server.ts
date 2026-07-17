import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { assertSafeProviderUrl } from '$lib/services/providers/url-guard';

interface TTSRequestBody {
	text: string;
	voice?: string;
	language?: string;
	speed?: number;
	exaggeration?: number;
	cfg_weight?: number;
	temperature?: number;
	baseUrl: string;
}

function isValidBody(body: unknown): body is TTSRequestBody {
	return (
		body !== null &&
		typeof body === 'object' &&
		'text' in body &&
		typeof (body as TTSRequestBody).text === 'string' &&
		'baseUrl' in body &&
		typeof (body as TTSRequestBody).baseUrl === 'string'
	);
}

function badRequest(message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 400,
		headers: { 'Content-Type': 'application/json' }
	});
}

function buildStreamingWavHeader(sampleRate: number, numChannels: number, bytesPerSample: number): Uint8Array {
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const bitsPerSample = bytesPerSample * 8;

	const writeString = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) {
			header[offset + i] = str.charCodeAt(i);
		}
	};

	writeString(0, 'RIFF');
	view.setUint32(4, 0xffffffff, true); // streaming: unknown final size
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // subchunk size
	view.setUint16(20, 3, true); // IEEE float
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeString(36, 'data');
	view.setUint32(40, 0xffffffff, true); // streaming: unknown data size

	return header;
}

function voiceToServerPath(voice: string): string {
	if (voice.startsWith('ref:')) {
		return `reference_audio/${voice.slice(4)}.wav`;
	}
	return `voices/${voice}.wav`;
}

/**
 * Proxies Chatterbox-NG's WebSocket `/ws/tts` as an HTTP `audio/wav` stream.
 *
 * Browsers cannot reliably open `ws://localhost` from `https` origins or from
 * remote clients. The server-side endpoint handles the WebSocket connection and
 * wraps the returned float32 PCM chunks in a streaming WAV header so the client
 * can decode them with the existing Web Audio pipeline.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON body');
	}

	if (!isValidBody(body)) {
		return badRequest('Request must include text and baseUrl strings');
	}

	const { text, voice, language, exaggeration, cfg_weight, temperature, baseUrl } = body;

	let wsUrl: URL;
	try {
		const url = assertSafeProviderUrl(baseUrl, env.ALLOW_LOCAL_PROVIDER_HOSTS === 'true');
		wsUrl = new URL('/ws/tts', url);
		wsUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	} catch (e) {
		return badRequest(e instanceof Error ? e.message : 'Invalid Chatterbox-NG base URL');
	}

	const abortSignal = request.signal;

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;
			let sampleRate = 24000;
			let headerSent = false;

			const ws = new WebSocket(wsUrl.toString());
			ws.binaryType = 'arraybuffer';

			const cleanup = () => {
				if (closed) return;
				closed = true;
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			};

			abortSignal.addEventListener('abort', () => {
				controller.error(new Error('Aborted'));
				cleanup();
			});

			ws.onopen = () => {
				const params: Record<string, unknown> = {
					text,
					sentence_pipelining: true
				};
				if (language) params.language_id = language;
				if (voice && voice !== 'default') {
					params.audio_prompt_path = voiceToServerPath(voice);
				}
				if (exaggeration !== undefined) params.exaggeration = exaggeration;
				if (cfg_weight !== undefined) params.cfg_weight = cfg_weight;
				if (temperature !== undefined) params.temperature = temperature;

				ws.send(JSON.stringify(params));
			};

			ws.onmessage = (event) => {
				if (closed) return;

				if (typeof event.data === 'string') {
					let msg: Record<string, unknown>;
					try {
						msg = JSON.parse(event.data);
					} catch {
						return;
					}

					if (typeof msg.sample_rate === 'number') {
						sampleRate = msg.sample_rate;
					}

					if (msg.status === 'done') {
						controller.close();
						cleanup();
					}

					if (msg.error) {
						controller.error(new Error(String(msg.error)));
						cleanup();
					}
				} else {
					if (!headerSent) {
						controller.enqueue(buildStreamingWavHeader(sampleRate, 1, 4));
						headerSent = true;
					}
					const bytes =
						event.data instanceof ArrayBuffer
							? new Uint8Array(event.data)
							: new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
					controller.enqueue(bytes);
				}
			};

			ws.onerror = () => {
				if (closed) return;
				controller.error(new Error('Chatterbox-NG WebSocket connection failed'));
				cleanup();
			};

			ws.onclose = () => {
				if (closed) return;
				controller.close();
				closed = true;
			};
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'audio/wav',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

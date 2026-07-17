import {
	getSharedAudioContext,
	type ITTSProvider,
	type TTSOptions,
	type TTSSpeakResult,
	type StreamOptions,
	type AudioChunk
} from './index.ts';

function ensureTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : url + '/';
}

/**
 * Client for Chatterbox-NG (Oasi Systems fork).
 *
 * Chatterbox-NG speaks over a proprietary WebSocket (`/ws/tts`). Browsers cannot
 * reliably open `localhost` WebSockets from `https` origins or remote clients, so
 * this provider talks to a SvelteKit proxy endpoint (`/api/tts/chatterbox/stream`)
 * which forwards the request to the Chatterbox container and streams back WAV bytes.
 */
export class ChatterboxTTS implements ITTSProvider {
	private baseUrl: string;
	private voiceId: string;
	private speed: number;
	private exaggeration?: number;
	private cfgWeight?: number;
	private temperature?: number;

	readonly capabilities = {
		streaming: true,
		emotion: true,
		multilingual: true,
		// Chatterbox-NG is a single-GPU diffusion model; overlapping synthesis
		// requests would queue internally anyway and hurt time-to-first-audio.
		maxConcurrentSynthesis: 1
	};

	constructor(options: TTSOptions) {
		this.baseUrl = ensureTrailingSlash(options.baseUrl || 'http://localhost:8765/');
		this.voiceId = options.voiceId || 'default';
		this.speed = options.speed ?? 1;
		this.exaggeration = options.exaggeration;
		this.cfgWeight = options.cfgWeight;
		this.temperature = options.temperature;
	}

	getAudioContext(): AudioContext {
		return getSharedAudioContext();
	}

	async speak(text: string): Promise<TTSSpeakResult> {
		const chunks: ArrayBuffer[] = [];
		for await (const chunk of this.speakStreaming(text)) {
			if (!chunk.done) chunks.push(chunk.data);
		}
		const combined = combineArrayBuffers(chunks);
		const audioContext = this.getAudioContext();
		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}
		const buffer = await audioContext.decodeAudioData(combined);

		const source = audioContext.createBufferSource();
		source.buffer = buffer;

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;

		source.connect(analyser);
		analyser.connect(audioContext.destination);
		source.start(0);

		return { source, analyser };
	}

	async *speakStreaming(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk> {
		const body = buildRequestBody(text, {
			voiceId: options?.voiceId ?? this.voiceId,
			language: options?.language,
			speed: options?.speed ?? this.speed,
			exaggeration: options?.exaggeration ?? this.exaggeration,
			cfgWeight: options?.cfgWeight ?? this.cfgWeight,
			temperature: options?.temperature ?? this.temperature,
			baseUrl: this.baseUrl
		});

		const response = await fetch('/api/tts/chatterbox/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			let detail = `Chatterbox-NG error ${response.status}`;
			try {
				const body = await response.text();
				if (body) detail = body.slice(0, 200);
			} catch {
				/* ignore */
			}
			throw new Error(detail);
		}

		if (!response.body) {
			throw new Error('Chatterbox-NG stream returned no response body');
		}

		const reader = response.body.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					yield { data: new ArrayBuffer(0), done: true };
					break;
				}
				if (value && value.byteLength > 0) {
					yield { data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), done: false };
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
}

interface RequestBodyOptions {
	voiceId: string;
	language?: string;
	speed?: number;
	exaggeration?: number;
	cfgWeight?: number;
	temperature?: number;
	baseUrl: string;
}

function buildRequestBody(text: string, options: RequestBodyOptions): Record<string, unknown> {
	const body: Record<string, unknown> = {
		text,
		voice: options.voiceId,
		baseUrl: options.baseUrl
	};
	if (options.language) body.language = options.language;
	if (options.speed !== undefined && options.speed !== 1) body.speed = options.speed;
	if (options.exaggeration !== undefined) body.exaggeration = options.exaggeration;
	if (options.cfgWeight !== undefined) body.cfg_weight = options.cfgWeight;
	if (options.temperature !== undefined) body.temperature = options.temperature;
	return body;
}

function combineArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
	const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
	const combined = new Uint8Array(total);
	let offset = 0;
	for (const b of buffers) {
		combined.set(new Uint8Array(b), offset);
		offset += b.byteLength;
	}
	return combined.buffer;
}

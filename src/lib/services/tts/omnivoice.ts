import {
	getSharedAudioContext,
	type ITTSProvider,
	type TTSOptions,
	type TTSSpeakResult,
	type TTSCapabilities,
	type StreamOptions,
	type AudioChunk
} from './index';

/**
 * OmniVoiceTTS — server-proxied streaming TTS provider for OmniVoice.
 *
 * OmniVoice generates audio with RTF ~0.5 (2× realtime) and supports
 * 600+ languages. The browser posts to /api/tts/omnivoice/stream, and
 * the SvelteKit server proxies the request to the OmniVoice container.
 *
 * Audio format: PCM-16 WAV at 24 kHz mono, streamed sentence by sentence.
 */
export class OmniVoiceTTS implements ITTSProvider {
	private voiceId: string;
	private baseUrl: string;
	private numStep: number;

	readonly capabilities: TTSCapabilities = {
		streaming: false,
		emotion: false,
		multilingual: true
	};

	constructor(options: TTSOptions) {
		this.voiceId = options.voiceId || 'female3';
		this.baseUrl = (options.baseUrl || 'http://localhost:8766/').replace(/\/+$/, '');
		this.numStep = options.omnivoiceNumStep ?? 32;
	}

	getAudioContext(): AudioContext {
		return getSharedAudioContext();
	}

	async speak(text: string): Promise<TTSSpeakResult> {
		const audioBuffer = await this.fetchAudioBuffer(text);
		const audioContext = this.getAudioContext();

		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		source.connect(analyser);
		analyser.connect(audioContext.destination);
		source.start(0);

		return { source, analyser };
	}

	async fetchAudioBuffer(text: string, options?: StreamOptions): Promise<AudioBuffer> {
		const audioContext = this.getAudioContext();
		if (audioContext.state === 'suspended' || audioContext.state === ('interrupted' as AudioContextState)) {
			await audioContext.resume();
		}

		const response = await this.requestStream(text, options);
		if (!response.ok) {
			const message = await response.text().catch(() => '');
			throw new Error(`OmniVoice TTS error: ${response.status} ${message}`);
		}

		const combined = response.body
			? await this.readStreamToBuffer(response.body)
			: await response.arrayBuffer();
		return audioContext.decodeAudioData(combined.slice(0));
	}

	async *speakStreaming(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk> {
		const response = await this.requestStream(text, options);
		if (!response.ok) {
			const message = await response.text().catch(() => '');
			throw new Error(`OmniVoice TTS error: ${response.status} ${message}`);
		}

		if (!response.body) {
			yield { data: await response.arrayBuffer(), done: false };
			yield { data: new ArrayBuffer(0), done: true };
			return;
		}

		const reader = response.body.getReader();
		try {
			while (true) {
				if (options?.signal?.aborted) return;
				const { value, done } = await reader.read();
				if (done) {
					yield { data: new ArrayBuffer(0), done: true };
					return;
				}
				if (value && value.byteLength > 0) {
					yield {
						data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
						done: false
					};
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private async requestStream(text: string, options?: StreamOptions): Promise<Response> {
		return fetch('/api/tts/omnivoice/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text,
				voice: options?.voiceId ?? this.voiceId,
				numStep: this.numStep,
				baseUrl: this.baseUrl,
				language: options?.language,
				...(options?.speed !== undefined ? { speed: options.speed } : {})
			}),
			signal: options?.signal
		});
	}

	private async readStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (!value || value.byteLength === 0) continue;
				chunks.push(value);
				total += value.byteLength;
			}
		} finally {
			reader.releaseLock();
		}
		const combined = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			combined.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return combined.buffer;
	}
}

import {
	getSharedAudioContext,
	type ITTSProvider,
	type TTSOptions,
	type TTSSpeakResult,
	type TTSCapabilities,
	type StreamOptions,
	type AudioChunk
} from './index';

function ensureTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : `${url}/`;
}

export class ChatterboxTTS implements ITTSProvider {
	private voiceId: string;
	private speed: number;
	private baseUrl: string;
	private exaggeration: number;
	private language: string | undefined;
	private cfgWeight: number | undefined;
	private temperature: number | undefined;

	readonly capabilities: TTSCapabilities = {
		streaming: true,
		emotion: true,
		multilingual: true
	};

	constructor(options: TTSOptions) {
		this.voiceId = options.voiceId || '';
		this.speed = options.speed ?? 1;
		this.baseUrl = ensureTrailingSlash(options.baseUrl || 'http://localhost:8300/');
		this.exaggeration = options.exaggeration ?? 0.5;
		this.language = options.language;
		this.cfgWeight = options.cfgWeight;
		this.temperature = options.temperature;
	}

	getAudioContext(): AudioContext {
		return getSharedAudioContext();
	}

	async speak(text: string): Promise<TTSSpeakResult> {
		const response = await fetch('/api/tts/chatterbox', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text,
				voice: this.voiceId,
				speed: this.speed,
				exaggeration: this.exaggeration,
				language: this.language,
				cfgWeight: this.cfgWeight,
				temperature: this.temperature,
				baseUrl: this.baseUrl
			})
		});

		if (!response.ok) {
			const msg = await response.text().catch(() => '');
			throw new Error(`Chatterbox TTS error: ${response.status} ${msg}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const audioContext = this.getAudioContext();

		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;

		source.connect(analyser);
		analyser.connect(audioContext.destination);

		source.start(0);

		return { source, analyser };
	}

	async *speakStreaming(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk> {
		const abortSignal = options?.signal;
		const response = await fetch('/api/tts/chatterbox/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text,
				voice: this.voiceId,
				speed: this.speed,
				exaggeration: options?.exaggeration ?? this.exaggeration,
				emotion: options?.emotion,
				language: options?.language ?? this.language,
				cfgWeight: this.cfgWeight,
				temperature: this.temperature,
				baseUrl: this.baseUrl
			}),
			signal: abortSignal
		});

		if (!response.ok) {
			const msg = await response.text().catch(() => '');
			throw new Error(`Chatterbox streaming error: ${response.status} ${msg}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('Chatterbox streaming: no response body');
		}

		try {
			while (true) {
				const { value, done } = await reader.read();

				if (abortSignal?.aborted) {
					await reader.cancel();
					return;
				}

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
}

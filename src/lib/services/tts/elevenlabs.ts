import { getSharedAudioContext, type ITTSProvider, type TTSOptions, type TTSSpeakResult } from './index';

function ensureTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : url + '/';
}

export class ElevenLabsTTS implements ITTSProvider {
	private apiKey: string;
	private voiceId: string;
	private model: string;
	private speed: number;
	private baseUrl: string;

	constructor(options: TTSOptions) {
		this.apiKey = options.apiKey || '';
		this.voiceId = options.voiceId || 'EXAVITQu4vr4xnSDxMaL';
		this.model = 'eleven_turbo_v2_5';
		this.speed = options.speed ?? 1;
		this.baseUrl = ensureTrailingSlash(options.baseUrl || 'https://api.elevenlabs.io/v1/');
	}

	getAudioContext(): AudioContext {
		return getSharedAudioContext();
	}

	async speak(text: string): Promise<TTSSpeakResult> {
		const audioBuffer = await this.fetchAudioBuffer(text);
		const audioContext = this.getAudioContext();

		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.playbackRate.value = this.speed;

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;

		source.connect(analyser);
		analyser.connect(audioContext.destination);

		// Start playback
		source.start(0);

		return { source, analyser };
	}

	async fetchAudioBuffer(text: string, options?: import('./index').StreamOptions): Promise<AudioBuffer> {
		const response = await fetch(
			`${this.baseUrl}text-to-speech/${this.voiceId}/stream`,
			{
				method: 'POST',
				headers: {
					'xi-api-key': this.apiKey,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					text,
					model_id: this.model,
					voice_settings: {
						stability: 0.5,
						similarity_boost: 0.75,
						speed: options?.speed ?? this.speed
					}
				}),
				signal: options?.signal
			}
		);

		if (!response.ok) {
			throw new Error(`ElevenLabs API error: ${response.status}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const audioContext = this.getAudioContext();

		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		return audioContext.decodeAudioData(arrayBuffer);
	}
}

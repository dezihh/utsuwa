import { getSharedAudioContext, type ITTSProvider, type TTSOptions, type TTSSpeakResult } from './index';

function ensureTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : `${url}/`;
}

function normalizeAudioBaseUrl(baseUrl: string): string {
	const clean = ensureTrailingSlash(baseUrl);
	return clean.endsWith('/api/') ? clean.replace(/\/api\/$/, '/') : clean;
}

export class AllTalkTTS implements ITTSProvider {
	private voiceId: string;
	private rvcVoiceId: string;
	private speed: number;
	private baseUrl: string;
	private language: string;

	constructor(options: TTSOptions) {
		this.voiceId = options.voiceId || '';
		this.rvcVoiceId = options.rvcVoiceId || '';
		this.speed = options.speed ?? 1;
		this.baseUrl = ensureTrailingSlash(options.baseUrl || 'http://localhost:7851/api/');
		this.language = 'de';
	}

	getAudioContext(): AudioContext {
		return getSharedAudioContext();
	}

	private createOutputFileName(): string {
		return `utsuwa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`;
	}

	private buildForm(text: string): URLSearchParams {
		return new URLSearchParams({
			text,
			voice: this.voiceId,
			language: this.language,
			output_file: this.createOutputFileName()
		});
	}

	private async fetchAudio(response: Response, baseUrl?: string): Promise<ArrayBuffer> {
		if (!response.ok) {
			const message = await response.text();
			throw new Error(`AllTalk API error: ${response.status} ${message}`);
		}

		const contentType = response.headers.get('content-type') || '';
		let audioResponse = response;

		if (contentType.includes('application/json')) {
			const payload = await response.json();
			const generatedFile =
				typeof payload?.output_file_path === 'string'
					? payload.output_file_path
					: typeof payload?.output_file === 'string'
						? payload.output_file
						: '';

			if (!generatedFile) {
				throw new Error('AllTalk did not return an output file');
			}

			if (!baseUrl) {
				throw new Error('AllTalk base URL is not available for audio fetch');
			}

			audioResponse = await fetch(new URL(`audio/${generatedFile.replace(/^\/+/, '')}`, normalizeAudioBaseUrl(baseUrl)));

			if (!audioResponse.ok) {
				const message = await audioResponse.text();
				throw new Error(`AllTalk audio fetch error: ${audioResponse.status} ${message}`);
			}
		}

		return audioResponse.arrayBuffer();
	}

	private async speakViaProxy(text: string): Promise<ArrayBuffer> {
		const response = await fetch('/api/tts/alltalk', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				text,
				voice: this.voiceId,
				...(this.rvcVoiceId ? { rvcvoice: this.rvcVoiceId } : {}),
				speed: this.speed,
				language: this.language,
				baseUrl: this.baseUrl
			})
		});

		return this.fetchAudio(response);
	}

	private async speakDirect(text: string): Promise<ArrayBuffer> {
		const response = await fetch(new URL('tts-generate-streaming', this.baseUrl), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: this.buildForm(text).toString()
		});

		return this.fetchAudio(response, this.baseUrl);
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
		source.start(0);

		return { source, analyser };
	}

	async fetchAudioBuffer(text: string, options?: import('./index').StreamOptions): Promise<AudioBuffer> {
		if (!this.voiceId) {
			throw new Error('AllTalk voice is not configured');
		}

		let arrayBuffer: ArrayBuffer;

		try {
			const response = await fetch('/api/tts/alltalk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text,
					voice: this.voiceId,
					...(this.rvcVoiceId ? { rvcvoice: this.rvcVoiceId } : {}),
					speed: this.speed,
					language: this.language,
					baseUrl: this.baseUrl
				}),
				signal: options?.signal
			});
			arrayBuffer = await this.fetchAudio(response);
		} catch (proxyError) {
			if ((proxyError as Error).name === 'AbortError') throw proxyError;
			console.warn('AllTalk proxy failed, falling back to direct request:', proxyError);
			const response = await fetch(new URL('tts-generate-streaming', this.baseUrl), {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: this.buildForm(text).toString(),
				signal: options?.signal
			});
			arrayBuffer = await this.fetchAudio(response, this.baseUrl);
		}

		const audioContext = this.getAudioContext();
		if (audioContext.state === 'suspended') await audioContext.resume();
		return audioContext.decodeAudioData(arrayBuffer);
	}
}

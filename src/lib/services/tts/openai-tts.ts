import {
	getSharedAudioContext,
	type ITTSProvider,
	type TTSOptions,
	type TTSSpeakResult,
	type StreamOptions,
	type TTSCapabilities
} from './index.ts';

/**
 * Build the request body for an OpenAI-compatible /audio/speech endpoint.
 * Exported so the body-construction logic can be unit-tested without an
 * AudioContext or a real fetch.
 */
export function buildOpenAITTSRequestBody(
	providerId: string,
	model: string,
	voiceId: string,
	speed: number,
	text: string,
	streamOptions?: StreamOptions
): Record<string, unknown> {
	const isOmnivoice = providerId === 'omnivoice';
	// Per-segment voice overrides (e.g. alternative language voice) take precedence
	// over the provider's default/primary voice.
	const effectiveVoiceId = streamOptions?.voiceId ?? voiceId;
	const body: Record<string, unknown> = {
		model,
		input: text,
		voice: effectiveVoiceId,
		speed: streamOptions?.speed ?? speed,
		response_format: isOmnivoice ? 'wav' : 'mp3'
	};

	const instructions = streamOptions?.instructions;
	if (isOmnivoice && instructions) {
		body.instructions = instructions;
	}
	if (isOmnivoice) {
		if (streamOptions?.language) body.language = streamOptions.language;
		// OmniVoice accepts num_step in the range 4-64. 0 is invalid and would
		// trigger a server error, so we drop out-of-range values instead.
		const numStep = streamOptions?.numStep;
		if (numStep != null && numStep >= 4 && numStep <= 64) {
			body.num_step = numStep;
		}
		if (streamOptions?.positionTemperature != null) {
			body.position_temperature = streamOptions.positionTemperature;
		}
		if (streamOptions?.classTemperature != null) {
			body.class_temperature = streamOptions.classTemperature;
		}
	}
	return body;
}
import {
	getTTSBaseUrl,
	getLocalTTSConnectionHint,
	isLocalTTSProvider
} from '../providers/local-endpoints.ts';
import { providerErrorMessage } from './provider-utils.ts';

function ensureTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : url + '/';
}

function getCurrentSiteOrigin(): string | undefined {
	return typeof window !== 'undefined' ? window.location.origin : undefined;
}

// Shared by OpenAI's hosted TTS and any OpenAI-compatible local server
// (Kokoro-FastAPI, openedai-speech). The provider id decides URL normalization,
// whether an API key is required, and the failure message.
export class OpenAITTS implements ITTSProvider {
	private apiKey: string;
	private voiceId: string;
	private model: string;
	private speed: number;
	private baseUrl: string;
	private isLocal: boolean;
	private providerId: string;

	constructor(options: TTSOptions) {
		this.apiKey = options.apiKey || '';
		this.voiceId = options.voiceId || 'alloy';
		this.model = options.model || 'tts-1';
		this.speed = options.speed ?? 1;
		this.providerId = options.provider;
		this.isLocal = isLocalTTSProvider(options.provider);
		this.baseUrl = this.isLocal
			? getTTSBaseUrl(options.provider, options.baseUrl)
			: ensureTrailingSlash(options.baseUrl || 'https://api.openai.com/v1/');
	}

	get capabilities(): TTSCapabilities {
		if (this.providerId === 'omnivoice') {
			return {
				streaming: false,
				emotion: true,
				multilingual: true,
				maxConcurrentSynthesis: 1,
				clientSideSpeed: false
			};
		}
		return {
			streaming: false,
			emotion: false,
			multilingual: false
		};
	}

	getAudioContext(): AudioContext {
		return getSharedAudioContext();
	}

	async speak(text: string): Promise<TTSSpeakResult> {
		const audioBuffer = await this.fetchAudioBuffer(text);
		return this.playAudioBuffer(audioBuffer);
	}

	async fetchAudioBuffer(text: string, options?: StreamOptions): Promise<AudioBuffer> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		// Local servers don't need a key; only send auth when we actually have one.
		if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		}

		const body = buildOpenAITTSRequestBody(
			this.providerId,
			this.model,
			this.voiceId,
			this.speed,
			text,
			options
		);
		if (this.providerId === 'omnivoice' && import.meta.env?.DEV) {
			console.log('[OpenAITTS] request body:', JSON.stringify(body));
		}

		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}audio/speech`, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: options?.signal
			});
		} catch (err) {
			// A thrown fetch is usually a refused connection or a CORS block, which
			// is the exact failure mode that broke local LLMs before they were fixed.
			if (this.isLocal) {
				throw new Error(getLocalTTSConnectionHint(this.baseUrl, getCurrentSiteOrigin(), this.providerId));
			}
			throw err;
		}

		if (!response.ok) {
			if (this.isLocal) {
				throw new Error(
					`Local TTS server returned ${response.status} at ${this.baseUrl}. Check the model and voice are valid for this server.`
				);
			}
			let body: unknown;
			try {
				body = await response.json();
			} catch {
				// non-JSON error body
			}
			throw new Error(providerErrorMessage('OpenAI TTS', response.status, body));
		}

		const arrayBuffer = await response.arrayBuffer();
		const audioContext = this.getAudioContext();

		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		return audioContext.decodeAudioData(arrayBuffer);
	}

	private playAudioBuffer(audioBuffer: AudioBuffer): TTSSpeakResult {
		const audioContext = this.getAudioContext();

		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;

		source.connect(analyser);
		analyser.connect(audioContext.destination);

		source.onended = () => {
			source.disconnect();
			analyser.disconnect();
		};

		source.start(0);

		return { source, analyser };
	}
}

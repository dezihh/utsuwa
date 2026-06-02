import {
	getTTSProvider,
	getSharedAudioContext,
	type TTSOptions,
	type StreamOptions,
	type ITTSProvider
} from '$lib/services/tts';

/**
 * Metadata attached to each speech segment by the response parser.
 * Fields beyond `text` are optional and only used by capable providers.
 */
export interface SpeechSegment {
	text: string;
	/** Emotion style hint forwarded to TTS (e.g. 'happy', 'sad') */
	emotion?: string;
	/** Emotion intensity 0.0-1.0 */
	exaggeration?: number;
	/** ISO 639-1 language code for multilingual switching */
	language?: string;
	/** VRM body action to trigger (e.g. wave, nod, jump) */
	action?: string;
	/** Optional speech speed override */
	speed?: number;
}

/** Callbacks the orchestrator fires so the UI can react synchronously. */
export interface OrchestratorCallbacks {
	/** Fired when a segment starts playing - for speech bubble sync */
	onSegmentStart?: (segment: SpeechSegment, index: number) => void;
	/** Fired when all segments have finished */
	onComplete?: () => void;
	/** Fired continuously with analyser data for lip-sync */
	onAnalyserUpdate?: (analyser: AnalyserNode) => void;
	/** Fired when a segment with an emotion tag starts */
	onEmotionChange?: (emotion: string | null) => void;
	/** Fired when a segment has an [action:xxx] tag */
	onAction?: (action: string) => void;
}

/**
 * VoiceOrchestrator - central layer between LLM output and TTS/VRM.
 */
export class VoiceOrchestrator {
	private abortController: AbortController | null = null;
	private currentSource: AudioBufferSourceNode | null = null;
	private currentAnalyser: AnalyserNode | null = null;
	private isPlaying = false;

	getAnalyser(): AnalyserNode | null {
		return this.currentAnalyser;
	}

	getIsPlaying(): boolean {
		return this.isPlaying;
	}

	async speakSegments(
		segments: SpeechSegment[],
		options: TTSOptions,
		callbacks?: OrchestratorCallbacks
	): Promise<void> {
		this.interrupt();

		this.abortController = new AbortController();
		this.isPlaying = true;

		const provider = getTTSProvider(options);

		try {
			for (let i = 0; i < segments.length; i++) {
				if (this.abortController.signal.aborted) break;

				const segment = segments[i];
				if (segment.emotion) callbacks?.onEmotionChange?.(segment.emotion);
				if (segment.action) callbacks?.onAction?.(segment.action);

				if (provider.capabilities?.streaming && provider.speakStreaming) {
					await this.playStreaming(provider, segment, i, callbacks);
				} else {
					await this.playNonStreaming(provider, segment, i, callbacks);
				}
			}
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				console.error('[VoiceOrchestrator] Playback error:', err);
			}
		} finally {
			this.isPlaying = false;
			this.currentAnalyser = null;
			this.currentSource = null;
			callbacks?.onEmotionChange?.(null);
			callbacks?.onComplete?.();
		}
	}

	interrupt(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}

		if (this.currentSource) {
			try {
				this.currentSource.stop();
			} catch {
				// Already stopped
			}
			this.currentSource = null;
		}

		this.currentAnalyser = null;
		this.isPlaying = false;
	}

	private async playNonStreaming(
		provider: ITTSProvider,
		segment: SpeechSegment,
		index: number,
		callbacks?: OrchestratorCallbacks
	): Promise<void> {
		const { source, analyser } = await provider.speak(segment.text);

		callbacks?.onSegmentStart?.(segment, index);

		this.currentSource = source;
		this.currentAnalyser = analyser;
		callbacks?.onAnalyserUpdate?.(analyser);

		await new Promise<void>((resolve) => {
			source.onended = () => resolve();
		});
	}

	private async playStreaming(
		provider: ITTSProvider,
		segment: SpeechSegment,
		index: number,
		callbacks?: OrchestratorCallbacks
	): Promise<void> {
		const audioContext = getSharedAudioContext();

		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		analyser.connect(audioContext.destination);

		this.currentAnalyser = analyser;
		callbacks?.onAnalyserUpdate?.(analyser);

		const streamOptions: StreamOptions = {
			emotion: segment.emotion,
			exaggeration: segment.exaggeration,
			language: segment.language,
			speed: segment.speed,
			signal: this.abortController?.signal
		};

		const generator = provider.speakStreaming!(segment.text, streamOptions);

		let isFirstChunk = true;
		const chunks: ArrayBuffer[] = [];

		for await (const chunk of generator) {
			if (this.abortController?.signal.aborted) return;

			if (chunk.done) break;

			if (chunk.data.byteLength > 0) {
				chunks.push(chunk.data);
			}

			if (isFirstChunk) {
				callbacks?.onSegmentStart?.(segment, index);
				isFirstChunk = false;
			}
		}

		if (this.abortController?.signal.aborted) return;

		const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
		if (totalLength === 0) return;

		const combined = new Uint8Array(totalLength);
		let offset = 0;
		for (const c of chunks) {
			combined.set(new Uint8Array(c), offset);
			offset += c.byteLength;
		}

		const audioBuffer = await audioContext.decodeAudioData(combined.buffer);
		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(analyser);

		this.currentSource = source;

		if (isFirstChunk) {
			callbacks?.onSegmentStart?.(segment, index);
		}

		source.start(0);

		await new Promise<void>((resolve) => {
			source.onended = () => resolve();
		});
	}
}

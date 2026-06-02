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

// ---------------------------------------------------------------------------
// Internal async producer-consumer queue for the pipeline
// ---------------------------------------------------------------------------

interface PipelineItem {
	segment: SpeechSegment;
	index: number;
	/** Resolves to the decoded AudioBuffer once synthesis is complete */
	bufferPromise: Promise<AudioBuffer | null>;
}

/**
 * Lightweight single-consumer async queue.
 * push() adds items; close() signals the end of the stream.
 * next() returns the next item or null when the queue is closed and drained.
 */
class PipelineQueue {
	private queue: PipelineItem[] = [];
	private waiter: ((item: PipelineItem | null) => void) | null = null;
	private closed = false;

	push(item: PipelineItem): void {
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w(item);
		} else {
			this.queue.push(item);
		}
	}

	close(): void {
		this.closed = true;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w(null);
		}
	}

	next(): Promise<PipelineItem | null> {
		if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!);
		if (this.closed) return Promise.resolve(null);
		return new Promise((resolve) => {
			this.waiter = resolve;
		});
	}
}

// ---------------------------------------------------------------------------

/**
 * VoiceOrchestrator — central layer between LLM output and TTS/VRM.
 *
 * Pipeline mode (preferred):
 *   beginSession() → pushSegment() × N → endSession() → await result
 *
 * Legacy batch mode (still supported):
 *   speakSegments(allSegments, …)
 *
 * Key property: synthesis of segment N+1 starts as soon as pushSegment() is
 * called, overlapping with playback of segment N. This eliminates the
 * inter-sentence gap caused by sequential fetch → play → fetch → play.
 */
export class VoiceOrchestrator {
	private currentSource: AudioBufferSourceNode | null = null;
	private currentAnalyser: AnalyserNode | null = null;
	private isPlaying = false;

	// Pipeline state
	private channel: PipelineQueue | null = null;
	private pipelineAbort: AbortController | null = null;
	private sessionOptions: TTSOptions | null = null;
	private pipelineIndex = 0;
	private pipelineDoneResolve: (() => void) | null = null;
	private pipelineDone: Promise<void> = Promise.resolve();
	private pipelineDoneResolved = true;

	getAnalyser(): AnalyserNode | null {
		return this.currentAnalyser;
	}

	getIsPlaying(): boolean {
		return this.isPlaying;
	}

	// -------------------------------------------------------------------------
	// Legacy batch API — keeps backward compatibility
	// -------------------------------------------------------------------------

	async speakSegments(
		segments: SpeechSegment[],
		options: TTSOptions,
		callbacks?: OrchestratorCallbacks
	): Promise<void> {
		this.beginSession(options, callbacks);
		for (const seg of segments) {
			this.pushSegment(seg);
		}
		return this.endSession();
	}

	// -------------------------------------------------------------------------
	// Pipeline API — preferred for streaming LLM output
	// -------------------------------------------------------------------------

	/**
	 * Start a new speech session.
	 * Any in-progress session is interrupted first.
	 */
	beginSession(options: TTSOptions, callbacks?: OrchestratorCallbacks): void {
		this.interrupt();

		this.sessionOptions = options;
		this.pipelineAbort = new AbortController();
		this.pipelineIndex = 0;
		this.channel = new PipelineQueue();
		this.pipelineDoneResolved = false;
		this.pipelineDone = new Promise<void>((resolve) => {
			this.pipelineDoneResolve = resolve;
		});

		// Start the async pipeline runner (fire-and-forget; resolves pipelineDone)
		this.runPipeline(callbacks).catch((err) => {
			if ((err as Error).name !== 'AbortError') {
				console.error('[VoiceOrchestrator] Pipeline error:', err);
			}
		});
	}

	/**
	 * Push a segment into the pipeline.
	 * Synthesis starts immediately in the background.
	 */
	pushSegment(segment: SpeechSegment): void {
		if (!this.channel || !this.sessionOptions || this.pipelineAbort?.signal.aborted) return;

		const provider = getTTSProvider(this.sessionOptions);
		const signal = this.pipelineAbort.signal;
		const index = this.pipelineIndex++;

		const bufferPromise = this.fetchBuffer(provider, segment, signal);

		this.channel.push({ segment, index, bufferPromise });
	}

	/**
	 * Signal that no more segments will be pushed.
	 * Returns a promise that resolves when all audio has finished playing.
	 */
	endSession(): Promise<void> {
		this.channel?.close();
		return this.pipelineDone;
	}

	interrupt(): void {
		this.pipelineAbort?.abort();
		this.pipelineAbort = null;

		this.channel?.close();
		this.channel = null;

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
		this.resolvePipeline();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private resolvePipeline(): void {
		if (!this.pipelineDoneResolved) {
			this.pipelineDoneResolved = true;
			this.pipelineDoneResolve?.();
			this.pipelineDoneResolve = null;
		}
	}

	private async runPipeline(callbacks?: OrchestratorCallbacks): Promise<void> {
		this.isPlaying = true;

		try {
			while (true) {
				if (this.pipelineAbort?.signal.aborted) break;

				const item = await this.channel!.next();
				if (item === null) break; // channel closed (endSession called)

				if (this.pipelineAbort?.signal.aborted) break;

				// Wait for synthesis to finish (may already be done if model was fast)
				let buffer: AudioBuffer | null = null;
				try {
					buffer = await item.bufferPromise;
				} catch (err) {
					if ((err as Error).name === 'AbortError') break;
					console.error('[VoiceOrchestrator] Synthesis failed for segment:', item.segment.text, err);
					continue; // skip this segment
				}

				if (!buffer || this.pipelineAbort?.signal.aborted) continue;

				// Fire side-effect callbacks before playing
				if (item.segment.emotion) callbacks?.onEmotionChange?.(item.segment.emotion);
				if (item.segment.action) callbacks?.onAction?.(item.segment.action);

				await this.playBuffer(buffer, item.segment, item.index, callbacks);
			}
		} finally {
			this.isPlaying = false;
			this.currentSource = null;
			this.currentAnalyser = null;
			callbacks?.onEmotionChange?.(null);
			callbacks?.onComplete?.();
			this.resolvePipeline();
		}
	}

	/**
	 * Fetch and decode audio to an AudioBuffer (without starting playback).
	 * Synthesis runs in the background while the previous segment plays.
	 */
	private async fetchBuffer(
		provider: ITTSProvider,
		segment: SpeechSegment,
		signal: AbortSignal
	): Promise<AudioBuffer | null> {
		const streamOpts: StreamOptions = {
			emotion: segment.emotion,
			exaggeration: segment.exaggeration,
			language: segment.language,
			speed: segment.speed,
			signal
		};

		if (signal.aborted) return null;

		try {
			// Preferred path: provider implements fetchAudioBuffer
			if (provider.fetchAudioBuffer) {
				return await provider.fetchAudioBuffer(segment.text, streamOpts);
			}

			// Fallback: collect all chunks from speakStreaming
			if (provider.capabilities?.streaming && provider.speakStreaming) {
				return await this.collectStreamingBuffer(provider, segment, streamOpts);
			}

			// Last resort: provider only has speak() which starts playback immediately.
			// We can't prefetch, so return null and let playBuffer fall back.
			return null;
		} catch (err) {
			if (signal.aborted || (err as Error).name === 'AbortError') return null;
			throw err;
		}
	}

	private async collectStreamingBuffer(
		provider: ITTSProvider,
		segment: SpeechSegment,
		opts: StreamOptions
	): Promise<AudioBuffer | null> {
		const generator = provider.speakStreaming!(segment.text, opts);
		const chunks: ArrayBuffer[] = [];

		for await (const chunk of generator) {
			if (opts.signal?.aborted) return null;
			if (chunk.done) break;
			if (chunk.data.byteLength > 0) chunks.push(chunk.data);
		}

		const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
		if (totalLength === 0) return null;

		const combined = new Uint8Array(totalLength);
		let offset = 0;
		for (const c of chunks) {
			combined.set(new Uint8Array(c), offset);
			offset += c.byteLength;
		}

		const audioContext = getSharedAudioContext();
		if (audioContext.state === 'suspended') await audioContext.resume();
		return audioContext.decodeAudioData(combined.buffer);
	}

	private async playBuffer(
		buffer: AudioBuffer,
		segment: SpeechSegment,
		index: number,
		callbacks?: OrchestratorCallbacks
	): Promise<void> {
		const audioContext = getSharedAudioContext();
		console.debug('[Orchestrator] playBuffer', index, 'ctx state:', audioContext.state, 'duration:', buffer.duration.toFixed(2) + 's');

		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		analyser.connect(audioContext.destination);

		const source = audioContext.createBufferSource();
		source.buffer = buffer;
		source.connect(analyser);

		this.currentSource = source;
		this.currentAnalyser = analyser;

		console.debug('[Orchestrator] firing onSegmentStart + onAnalyserUpdate for index', index);
		callbacks?.onSegmentStart?.(segment, index);
		callbacks?.onAnalyserUpdate?.(analyser);

		source.start(0);

		await new Promise<void>((resolve) => {
			source.onended = () => resolve();
			// Resolve immediately if the session is interrupted mid-playback
			this.pipelineAbort?.signal.addEventListener('abort', resolve, { once: true });
		});

		if (this.pipelineAbort?.signal.aborted) {
			try {
				source.stop();
			} catch {
				// Already stopped
			}
		}
	}
}

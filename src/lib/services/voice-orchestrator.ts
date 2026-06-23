import {
	getTTSProvider,
	getSharedAudioContext,
	type TTSOptions,
	type StreamOptions,
	type ITTSProvider
} from '$lib/services/tts';
import { applyEmotionToSegment, type AudioEffects } from '$lib/services/tts/emotion-applier';

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
	/** Optional pitch override (formant shift multiplier) */
	pitch?: number;
	/** Optional volume override (gain multiplier) */
	volume?: number;
	/** Voice selector: 'default' | 'alt' | literal voice ID. Resolved by orchestrator. */
	voiceId?: string;
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
// Simple counting semaphore for limiting parallel TTS synthesis requests
// ---------------------------------------------------------------------------

class Semaphore {
	private slots: number;
	private queue: (() => void)[] = [];

	constructor(limit: number) {
		this.slots = limit;
	}

	acquire(): Promise<void> {
		if (this.slots > 0) {
			this.slots--;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => this.queue.push(resolve));
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.slots++;
		}
	}

	/** Drain pending waiters (e.g. on interrupt) so they can check abort state. */
	drainAndReset(limit: number): void {
		this.slots = limit;
		const pending = this.queue.splice(0);
		for (const w of pending) w();
	}
}

// ---------------------------------------------------------------------------
// Internal async producer-consumer queue for the pipeline
// ---------------------------------------------------------------------------

interface PipelineItem {
	segment: SpeechSegment;
	index: number;
	/** Batch path: resolves to the decoded AudioBuffer once synthesis is complete */
	bufferPromise?: Promise<AudioBuffer | null>;
	/** Streaming path: called when the runner is ready to play this segment */
	streamPlay?: (callbacks?: OrchestratorCallbacks) => Promise<void>;
	/** Client-side audio effects to apply during playback */
	audioEffects?: AudioEffects;
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
	private bufferedStreamingSegments: SpeechSegment[] = [];
	private currentSource: AudioBufferSourceNode | null = null;
	private currentAnalyser: AnalyserNode | null = null;
	private isPlaying = false;

	// Pipeline state
	private channel: PipelineQueue | null = null;
	private pipelineAbort: AbortController | null = null;
	private sessionOptions: TTSOptions | null = null;
	private pipelineIndex = 0;
	// Inferred alt language: set to the first explicitly-tagged language seen when
	// sessionOptions.language (primary language) is not configured. Lets us distinguish
	// "Spanish = alt" from "German = default" even without explicit primary language config.
	private inferredAltLanguage: string | undefined = undefined;
	private pipelineDoneResolve: (() => void) | null = null;
	private pipelineDone: Promise<void> = Promise.resolve();
	private pipelineDoneResolved = true;

	// Limits parallel TTS synthesis requests (important for single-GPU diffusion models)
	private synthesisLimiter = new Semaphore(Infinity);

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
		this.inferredAltLanguage = undefined;
		this.bufferedStreamingSegments = [];
		this.channel = new PipelineQueue();

		// Apply provider-specific concurrency limit (e.g. OmniVoice = 2)
		const provider = getTTSProvider(options);
		const limit = provider.capabilities?.maxConcurrentSynthesis ?? Infinity;
		this.synthesisLimiter.drainAndReset(limit);
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

		// Skip segments that contain only emoji, whitespace, or punctuation — these produce
		// no meaningful speech but still incur full TTS generation overhead.
		// But keep empty segments so VOX can trigger for valid speech
		const textContent = segment.text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{P}]/gu, '');
		if (!textContent.trim()) return;

		// Auto-assign alt voice when language differs from the configured primary language.
		// Requires sessionOptions.language to be set — without a known primary language we
		// cannot reliably distinguish "alt language" from "primary language explicitly tagged".
		if (!segment.voiceId && this.sessionOptions.alternativeVoiceId && segment.language && this.sessionOptions.language) {
			if (segment.language !== this.sessionOptions.language) {
				segment = { ...segment, voiceId: 'alt' };
			}
		}

		const provider = getTTSProvider(this.sessionOptions);
		const abort = this.pipelineAbort;
		if (!abort) return;
		const signal = abort.signal;
		const index = this.pipelineIndex++;

		// Apply provider-specific emotion configuration
		const { segment: modifiedSegment, audioEffects } = applyEmotionToSegment(
			segment,
			this.sessionOptions.provider
		);

		// For streaming providers (Chatterbox): buffer segments and combine into one
		// request in endSession. This enables sentence_pipelining=true which drops
		// RTF from 1.5 to ~1.0 and allows gapless progressive playback.
		if (provider.capabilities?.streaming && provider.speakStreaming) {
			this.bufferedStreamingSegments.push(modifiedSegment);
			return;
		}

		// Non-streaming providers: batch path (prefetch while previous segment plays)
		const bufferPromise = this.fetchBuffer(provider, modifiedSegment, signal);
		this.channel.push({ segment: modifiedSegment, index, bufferPromise, audioEffects });
	}

	/**
	 * Signal that no more segments will be pushed.
	 * Returns a promise that resolves when all audio has finished playing.
	 */
	endSession(): Promise<void> {
		// Flush buffered streaming segments as one combined Chatterbox call.
		// sentence_pipelining=true on the server means Chatterbox handles splitting
		// internally with a shared HiFiGAN state — continuous audio, RTF ~1.0.
		if (this.bufferedStreamingSegments.length > 0 && this.channel && this.sessionOptions && this.pipelineAbort) {
			const segments = [...this.bufferedStreamingSegments];
			this.bufferedStreamingSegments = [];
			const provider = getTTSProvider(this.sessionOptions);
			const signal = this.pipelineAbort.signal;
			const index = this.pipelineIndex++;
			const { audioEffects } = applyEmotionToSegment(segments[0], this.sessionOptions.provider);
			this.channel.push({
				segment: segments[0],
				index,
				streamPlay: (cb) => this.playAllAsOneStream(provider, segments, index, signal, cb, audioEffects),
				audioEffects
			});
		}
		this.channel?.close();
		return this.pipelineDone;
	}

	interrupt(): void {
		this.pipelineAbort?.abort();
		this.pipelineAbort = null;

		this.synthesisLimiter.drainAndReset(Infinity);

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

				// Streaming path: synthesis and playback happen together
				if (item.streamPlay) {
					await item.streamPlay(callbacks);
					continue;
				}

				// Batch path: wait for synthesis to finish (may already be done)
				let buffer: AudioBuffer | null = null;
				const t0 = performance.now();
				try {
					buffer = await item.bufferPromise!;
				} catch (err) {
					if ((err as Error).name === 'AbortError') break;
					console.error('[VoiceOrchestrator] Synthesis failed for segment:', item.segment.text, err);
					continue; // skip this segment
				}

				if (!buffer || this.pipelineAbort?.signal.aborted) continue;

				// Fire side-effect callbacks before playing
				if (item.segment.emotion) callbacks?.onEmotionChange?.(item.segment.emotion);
				if (item.segment.action) callbacks?.onAction?.(item.segment.action);

				await this.playBuffer(buffer, item.segment, item.index, callbacks, item.audioEffects);
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
	private resolveVoiceId(tag: string | undefined): string | undefined {
		if (!tag || tag === 'default') return undefined;
		if (tag === 'alt') return this.sessionOptions?.alternativeVoiceId || undefined;
		return tag;
	}

	private async fetchBuffer(
		provider: ITTSProvider,
		segment: SpeechSegment,
		signal: AbortSignal
	): Promise<AudioBuffer | null> {
		const baseSpeed =
			segment.voiceId === 'alt'
				? (this.sessionOptions?.alternativeSpeed ?? this.sessionOptions?.speed)
				: this.sessionOptions?.speed;
		const streamOpts: StreamOptions = {
			emotion: segment.emotion,
			exaggeration: segment.exaggeration,
			language: segment.language,
			speed: segment.speed ?? baseSpeed,
			pitch: segment.pitch,
			volume: segment.volume,
			voiceId: this.resolveVoiceId(segment.voiceId),
			signal
		};

		if (signal.aborted) return null;

		// Acquire a synthesis slot — limits parallel requests to the provider's
		// maxConcurrentSynthesis cap (e.g. 2 for OmniVoice). This prevents all
		// segments from being synthesised in one GPU batch, which would delay the
		// first segment by the full batch duration instead of just one segment.
		await this.synthesisLimiter.acquire();
		if (signal.aborted) {
			this.synthesisLimiter.release();
			return null;
		}

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
		} finally {
			this.synthesisLimiter.release();
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

		// Manual IEEE Float WAV decoder — avoids decodeAudioData() which may not support
		// format-3 (IEEE float) WAV on iOS Safari.
		const PCM_HEADER_SIZE = 44;
		if (combined.byteLength <= PCM_HEADER_SIZE) return null;
		const dv = new DataView(combined.buffer);
		const audioFormat   = dv.getUint16(20, true); // 1 = PCM16, 3 = IEEE float32
		const numChannels   = dv.getUint16(22, true);
		const sampleRate    = dv.getUint32(24, true);
		const bitsPerSample = dv.getUint16(34, true);
		const bytesPerSample = bitsPerSample / 8;

		const payload = combined.slice(PCM_HEADER_SIZE);
		const numSamples = Math.floor(payload.byteLength / bytesPerSample);
		const samplesPerChannel = Math.floor(numSamples / numChannels);
		if (samplesPerChannel === 0) return null;

		const float32 = new Float32Array(numSamples);
		const pdv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		if (audioFormat === 3) {
			for (let i = 0; i < numSamples; i++) float32[i] = pdv.getFloat32(i * 4, true);
		} else {
			for (let i = 0; i < numSamples; i++) float32[i] = pdv.getInt16(i * 2, true) / 32768.0;
		}

		const audioContext = getSharedAudioContext();
		if (audioContext.state === 'suspended') await audioContext.resume();
		const audioBuffer = audioContext.createBuffer(numChannels, samplesPerChannel, sampleRate);
		if (numChannels === 1) {
			audioBuffer.getChannelData(0).set(float32);
		} else {
			for (let ch = 0; ch < numChannels; ch++) {
				const chData = audioBuffer.getChannelData(ch);
				for (let i = 0; i < samplesPerChannel; i++) chData[i] = float32[i * numChannels + ch];
			}
		}
		return audioBuffer;
	}

	private async playBuffer(
		buffer: AudioBuffer,
		segment: SpeechSegment,
		index: number,
		callbacks?: OrchestratorCallbacks,
		audioEffects?: AudioEffects
	): Promise<void> {
		const audioContext = getSharedAudioContext();
		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		// Build audio effect chain: source → filter (pitch/formant) → gain (volume) → analyser → destination
		let lastNode: AudioNode;

		const source = audioContext.createBufferSource();
		source.buffer = buffer;
		lastNode = source;

		// Formant-shift via BiquadFilter for pitch
		if (audioEffects?.pitch !== undefined && audioEffects.pitch !== 1) {
			const filter = audioContext.createBiquadFilter();
			filter.type = 'peaking';
			filter.frequency.value = 2500;
			filter.Q.value = 1;
			// Map pitch 0.5-2.0 to gain -12dB to +12dB
			filter.gain.value = (audioEffects.pitch - 1) * 12;
			source.connect(filter);
			lastNode = filter;
		}

		// Volume via GainNode
		if (audioEffects?.volume !== undefined && audioEffects.volume !== 1) {
			const gainNode = audioContext.createGain();
			gainNode.gain.value = Math.max(0, audioEffects.volume);
			lastNode.connect(gainNode);
			lastNode = gainNode;
		}

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		lastNode.connect(analyser);
		analyser.connect(audioContext.destination);

		this.currentSource = source;
		this.currentAnalyser = analyser;

		callbacks?.onSegmentStart?.(segment, index);
		callbacks?.onAnalyserUpdate?.(analyser);

		source.start(0);

		await new Promise<void>((resolve) => {
			source.onended = () => resolve();
			// Resolve immediately if the session is interrupted mid-playback
			this.pipelineAbort?.signal.addEventListener('abort', () => resolve(), { once: true });
		});

		if (this.pipelineAbort?.signal.aborted) {
			try {
				source.stop();
			} catch {
				// Already stopped
			}
		}

		source.disconnect();
		analyser.disconnect();
	}

	/**
	 * Stream all segments as ONE Chatterbox request with sentence_pipelining=true.
	 *
	 * How it works:
	 *   1. Combine segment texts into one string (Chatterbox splits internally).
	 *   2. Each streamed binary chunk is decoded and scheduled with precise Web Audio
	 *      timestamps: source.start(nextPlayTime); nextPlayTime += buffer.duration.
	 *   3. SCHEDULE_AHEAD_S seconds of "pre-roll" means the first chunk starts playing
	 *      slightly in the future, giving subsequent chunks time to arrive before their
	 *      scheduled start — gapless even at RTF ~1.0.
	 *
	 * With sentence_pipelining=true on Chatterbox server (RTF ~1.0):
	 *   - Chunk arrives every ~2.6s, each covers ~2.2s of audio.
	 *   - Surplus ~0.4s per chunk → SCHEDULE_AHEAD_S=1.5s absorbs up to ~3 cumulative surplus.
	 */
	private async playAllAsOneStream(
		provider: ITTSProvider,
		segments: SpeechSegment[],
		index: number,
		signal: AbortSignal,
		callbacks?: OrchestratorCallbacks,
		audioEffects?: AudioEffects
	): Promise<void> {
		const SCHEDULE_AHEAD_S = 1.5;

		const audioContext = getSharedAudioContext();
		if (audioContext.state === 'suspended' || audioContext.state === ('interrupted' as AudioContextState)) {
			await audioContext.resume();
		}

		let effectInput: AudioNode;
		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		effectInput = analyser;

		// Formant-shift via BiquadFilter for pitch
		if (audioEffects?.pitch !== undefined && audioEffects.pitch !== 1) {
			const filter = audioContext.createBiquadFilter();
			filter.type = 'peaking';
			filter.frequency.value = 2500;
			filter.Q.value = 1;
			filter.gain.value = (audioEffects.pitch - 1) * 12;
			filter.connect(effectInput);
			effectInput = filter;
		}

		// Volume via GainNode
		if (audioEffects?.volume !== undefined && audioEffects.volume !== 1) {
			const gainNode = audioContext.createGain();
			gainNode.gain.value = Math.max(0, audioEffects.volume);
			gainNode.connect(effectInput);
			effectInput = gainNode;
		}

		analyser.connect(audioContext.destination);
		this.currentAnalyser = analyser;

		try {
			// Use first segment for emotion/language params; fire callbacks once.
			const firstSeg = segments[0];
			if (firstSeg.emotion) callbacks?.onEmotionChange?.(firstSeg.emotion);
			if (firstSeg.action) callbacks?.onAction?.(firstSeg.action);
			callbacks?.onSegmentStart?.(firstSeg, index);
			callbacks?.onAnalyserUpdate?.(analyser);

			// Chatterbox streams the whole text as one continuous audio clip, so we only
			// get one natural segment-start event. Estimate per-sentence timings and fire
			// onSegmentStart for subsequent segments so the speech bubble advances
			// sentence-by-sentence instead of getting stuck on the first sentence.
			const segmentTimers: ReturnType<typeof setTimeout>[] = [];
			const CHARS_PER_SECOND = 13;
			let accumulatedMs = 0;
			for (let i = 1; i < segments.length; i++) {
				accumulatedMs += (segments[i - 1].text.length / CHARS_PER_SECOND) * 1000;
				const seg = segments[i];
				const segIndex = index + i;
				const fireAt = accumulatedMs;
				segmentTimers.push(
					setTimeout(() => {
						if (signal.aborted) return;
						callbacks?.onSegmentStart?.(seg, segIndex);
					}, fireAt)
				);
			}
			signal.addEventListener(
				'abort',
				() => {
					for (const t of segmentTimers) clearTimeout(t);
				},
				{ once: true }
			);

			// Build combined text. Ensure each sentence ends with sentence-final punctuation
			// so Chatterbox's sentence splitter works correctly.
			const combinedText = segments
				.map((s, i) => {
					const t = s.text.trim();
					if (i < segments.length - 1 && !/[.!?…。！？]$/.test(t)) return t + '.';
					return t;
				})
				.join(' ');

			const streamOpts: StreamOptions = {
				emotion: firstSeg.emotion,
				exaggeration: firstSeg.exaggeration,
				language: firstSeg.language,
				speed: firstSeg.speed,
				signal
			};

			const PCM_HEADER_SIZE = 44;
			let headerParsed = false;
			let audioFormat = 3;    // default: IEEE float32
			let numChannels = 1;
			let sampleRate = 24000;
			let bytesPerSample = 4;

			let remainder: Uint8Array = new Uint8Array(0);
			// nextPlayTime is set on first chunk: audioContext.currentTime + SCHEDULE_AHEAD_S
			let nextPlayTime = 0;
			let firstChunk = true;
			let lastSourceNode: AudioBufferSourceNode | null = null;
			let lastSourceEndTime = 0; // estimated wall-clock end of the last scheduled chunk

			const sources: AudioBufferSourceNode[] = [];

			// Register abort listener to stop all scheduled sources.
			const abortHandler = () => {
				for (const src of sources) {
					try { src.stop(); } catch { /* already stopped */ }
				}
			};
			signal.addEventListener('abort', abortHandler, { once: true });

			try {
				const generator = provider.speakStreaming!(combinedText, streamOpts);

				for await (const chunk of generator) {
					if (signal.aborted) break;
					if (chunk.done) break;
					if (chunk.data.byteLength === 0) continue;

					// Prepend any remainder bytes from the previous iteration.
					const incoming = new Uint8Array(chunk.data);
					let raw: Uint8Array;
					if (remainder.byteLength > 0) {
						raw = new Uint8Array(remainder.byteLength + incoming.byteLength);
						raw.set(remainder);
						raw.set(incoming, remainder.byteLength);
						remainder = new Uint8Array(0);
					} else {
						raw = incoming;
					}

					let pcmBytes: Uint8Array;

					if (!headerParsed) {
						// Need at least a full WAV header to parse format.
						if (raw.byteLength < PCM_HEADER_SIZE) {
							remainder = raw;
							continue;
						}
						const hdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
						audioFormat   = hdv.getUint16(20, true);
						numChannels   = hdv.getUint16(22, true);
						sampleRate    = hdv.getUint32(24, true);
						const bps     = hdv.getUint16(34, true);
						bytesPerSample = bps / 8;
						headerParsed  = true;
						pcmBytes = raw.slice(PCM_HEADER_SIZE);
					} else {
						pcmBytes = raw;
					}

					if (pcmBytes.byteLength === 0) continue;

					// Align to sample frame boundary.
					const frameSize = bytesPerSample * numChannels;
					const alignedBytes = Math.floor(pcmBytes.byteLength / frameSize) * frameSize;
					if (alignedBytes === 0) {
						remainder = pcmBytes;
						continue;
					}
					remainder = pcmBytes.slice(alignedBytes);

					// Decode aligned PCM bytes into Float32.
					const numSamples = alignedBytes / bytesPerSample;
					const samplesPerChannel = numSamples / numChannels;
					const float32 = new Float32Array(numSamples);
					const pdv = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, alignedBytes);
					if (audioFormat === 3) {
						for (let i = 0; i < numSamples; i++) float32[i] = pdv.getFloat32(i * 4, true);
					} else {
						for (let i = 0; i < numSamples; i++) float32[i] = pdv.getInt16(i * 2, true) / 32768.0;
					}

					// Build AudioBuffer.
					const audioBuffer = audioContext.createBuffer(numChannels, samplesPerChannel, sampleRate);
					if (numChannels === 1) {
						audioBuffer.getChannelData(0).set(float32);
					} else {
						for (let ch = 0; ch < numChannels; ch++) {
							const chData = audioBuffer.getChannelData(ch);
							for (let i = 0; i < samplesPerChannel; i++) chData[i] = float32[i * numChannels + ch];
						}
					}

					// Schedule chunk.
					if (firstChunk) {
						nextPlayTime = audioContext.currentTime + SCHEDULE_AHEAD_S;
						firstChunk = false;
					}

					const src = audioContext.createBufferSource();
					src.buffer = audioBuffer;
					src.connect(effectInput);
					this.currentSource = src;
					sources.push(src);
					src.start(nextPlayTime);
					lastSourceNode = src;
					lastSourceEndTime = nextPlayTime + audioBuffer.duration;
					nextPlayTime = lastSourceEndTime;
				}
			} catch (err) {
				if ((err as Error).name !== 'AbortError' && !signal.aborted) {
					console.error('[VoiceOrchestrator] playAllAsOneStream error:', err);
				}
			} finally {
				signal.removeEventListener('abort', abortHandler);
			}

			if (signal.aborted || !lastSourceNode) return;

			// Wait until all scheduled audio has finished playing.
			const remainingMs = (lastSourceEndTime - audioContext.currentTime) * 1000;
			if (remainingMs > 0) {
				await new Promise<void>((resolve) => {
					const id = setTimeout(resolve, remainingMs + 150);
					signal.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
				});
			}
		} finally {
			analyser.disconnect();
		}
	}
}

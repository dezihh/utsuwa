/**
 * Voice Activity Detection (VAD) service.
 *
 * Opens the microphone once and continuously monitors amplitude.
 * When speech is detected → starts buffering audio.
 * When silence is detected after speech → emits the recorded segment.
 *
 * Uses a rolling pre-buffer to capture audio just before speech onset.
 * Audio is captured as raw PCM via ScriptProcessorNode and emitted as WAV,
 * avoiding MediaRecorder format issues across browsers and platforms.
 */

export type VadServicePhase = 'idle' | 'listening' | 'recording';

export interface VadCallbacks {
	onPhaseChange?: (phase: VadServicePhase) => void;
	onAudioLevel?: (level: number) => void;
	/** Fired immediately when speech onset is detected (before segment is complete). */
	onSpeechStart?: () => void;
	/** Fired when a complete speech segment is ready. */
	onSegmentReady?: (blob: Blob, mimeType: string) => void;
	/** Fired when a detected segment is discarded as noise (too short / too quiet). */
	onNoiseDetected?: () => void;
	onError?: (message: string) => void;
}

export interface VadConfig {
	/** Normalized RMS amplitude threshold to detect speech. Default: 0.015 */
	speechThreshold?: number;
	/** Milliseconds of silence after speech to end the segment. Default: 1500 */
	silenceDurationMs?: number;
	/** Minimum speech duration (ms) to emit a segment. Shorter bursts are discarded. Default: 300 */
	minSpeechDurationMs?: number;
	/** Pre-buffer duration (ms) — audio captured before speech onset. Default: 300 */
	preBufferMs?: number;
}

// ScriptProcessorNode buffer size (must be power of 2).
// At 48 kHz → ~85 ms/chunk; at 44.1 kHz → ~93 ms/chunk.
const PCM_BUFFER_SIZE = 4096;

class VadService {
	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private processor: any | null = null; // ScriptProcessorNode (deprecated but universally supported)
	private callbacks: VadCallbacks | null = null;
	private animFrameId: number | null = null;

	// Pre-buffer: rolling window of recent PCM chunks before speech
	private preBuffer: Float32Array[] = [];
	private preBufferSlots = 3;

	// Active speech segment PCM chunks
	private speechSamples: Float32Array[] = [];
	private capturing = false;

	// VAD state
	private active = false;
	private phase: VadServicePhase = 'idle';
	private speaking = false;
	private speechStartMs = 0;
	private silenceStartMs = 0;

	// Noise floor calibration
	private static readonly CALIBRATION_MS = 3000;
	private calibrating = false;
	private calibrationEndMs = 0;
	private calibrationSamples: number[] = [];
	private calibratedBase = 0.02;
	private effectiveThreshold = 0.02;

	// Sensitivity: 1-10 scale. 1 = very insensitive (high threshold), 10 = very sensitive (low threshold).
	private sensitivityLevel = 5;

	// Config (user-supplied)
	private speechThreshold = 0.02;
	private silenceDurationMs = 2500;
	private minSpeechDurationMs = 500;
	private preBufferMs = 300;

	/** Map 1-10 sensitivity level to internal multiplier. 10 = most sensitive.
	 *
	 * Uses an exponential curve so the mid-range (levels 4-6) is noticeably
	 * more sensitive than before, while the extremes still cover very noisy
	 * and very quiet environments.
	 */
	private levelToMultiplier(level: number): number {
		const clamped = Math.max(1, Math.min(10, level));
		return 2.5 * Math.exp(-0.35 * (clamped - 1));
	}

	/** Set sensitivity as a 1-10 level. 1 = ignore most noise, 10 = detect very quiet speech. */
	setSensitivity(level: number) {
		this.sensitivityLevel = Math.max(1, Math.min(10, level));
		if (!this.calibrating) {
			this.effectiveThreshold = this.calibratedBase * this.levelToMultiplier(this.sensitivityLevel);
		}
	}

	getSensitivity(): number {
		return this.sensitivityLevel;
	}

	async start(callbacks: VadCallbacks, config?: VadConfig): Promise<boolean> {
		if (this.active) return true;

		this.callbacks = callbacks;
		if (config?.speechThreshold !== undefined) this.speechThreshold = config.speechThreshold;
		if (config?.silenceDurationMs !== undefined) this.silenceDurationMs = config.silenceDurationMs;
		if (config?.minSpeechDurationMs !== undefined) this.minSpeechDurationMs = config.minSpeechDurationMs;
		if (config?.preBufferMs !== undefined) this.preBufferMs = config.preBufferMs;

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: false
				}
			});
		} catch (err) {
			const messages: Record<string, string> = {
				NotAllowedError: 'Microphone access denied. Check system permissions.',
				NotFoundError: 'No microphone found.',
				NotReadableError: 'Microphone is busy.'
			};
			const msg =
				err instanceof DOMException
					? (messages[err.name] ?? `Microphone error: ${err.message}`)
					: 'Failed to access microphone';
			callbacks.onError?.(msg);
			return false;
		}

		this.audioContext = new AudioContext();
		if (this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
		}
		const source = this.audioContext.createMediaStreamSource(this.stream);

		this.analyser = this.audioContext.createAnalyser();
		this.analyser.fftSize = 512;
		source.connect(this.analyser);

		this.startPcmCapture(source);

		this.active = true;
		this.speaking = false;
		this.capturing = false;
		this.preBuffer = [];
		this.speechSamples = [];

		const bufferDurationMs = (PCM_BUFFER_SIZE / this.audioContext.sampleRate) * 1000;
		this.preBufferSlots = Math.max(1, Math.ceil(this.preBufferMs / bufferDurationMs));

		this.effectiveThreshold = this.speechThreshold;
		this.calibrating = true;
		this.calibrationEndMs = Date.now() + VadService.CALIBRATION_MS;
		this.calibrationSamples = [];

		this.setPhase('listening');
		this.startAmplitudeTick();
		return true;
	}

	stop(): void {
		this.active = false;
		this.speaking = false;
		this.capturing = false;
		this.calibrating = false;
		this.calibrationSamples = [];
		this.calibratedBase = this.speechThreshold;
		this.effectiveThreshold = this.speechThreshold;
		this.stopAmplitudeTick();
		this.stopPcmCapture();
		this.releaseStream();
		this.setPhase('idle');
		this.callbacks = null;
		this.preBuffer = [];
		this.speechSamples = [];
	}

	private setPhase(p: VadServicePhase) {
		this.phase = p;
		this.callbacks?.onPhaseChange?.(p);
	}

	private startPcmCapture(source: AudioNode) {
		if (!this.audioContext) return;
		const ctx = this.audioContext;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.processor = (ctx as any).createScriptProcessor(PCM_BUFFER_SIZE, 1, 1);

		this.processor.onaudioprocess = (event: AudioProcessingEvent) => {
			if (!this.active) return;
			const samples = new Float32Array(event.inputBuffer.getChannelData(0));

			if (this.capturing) {
				this.speechSamples.push(samples);
			} else {
				this.preBuffer.push(samples);
				if (this.preBuffer.length > this.preBufferSlots) {
					this.preBuffer.shift();
				}
			}
		};

		// ScriptProcessorNode must be in a connected graph to fire — route through
		// a silent gain so nothing is audible.
		const silentGain = ctx.createGain();
		silentGain.gain.value = 0;
		source.connect(this.processor);
		this.processor.connect(silentGain);
		silentGain.connect(ctx.destination);
	}

	private stopPcmCapture() {
		if (this.processor) {
			this.processor.disconnect();
			this.processor = null;
		}
	}

	private startAmplitudeTick() {
		if (!this.analyser) return;
		this.analyser.fftSize = 1024;
		const dataArray = new Uint8Array(this.analyser.fftSize);

		const tick = () => {
			if (!this.active || !this.analyser) return;

			this.analyser.getByteTimeDomainData(dataArray);
			let sumSq = 0;
			for (let i = 0; i < dataArray.length; i++) {
				const sample = (dataArray[i] - 128) / 128;
				sumSq += sample * sample;
			}
			const level = Math.sqrt(sumSq / dataArray.length);

			this.callbacks?.onAudioLevel?.(level);

			const now = Date.now();

			if (this.calibrating) {
				this.calibrationSamples.push(level);
				if (now >= this.calibrationEndMs) {
					this.calibrating = false;
					const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
					const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
					const MAX_CALIBRATED_BASE = 0.05;
					this.calibratedBase = Math.min(
						MAX_CALIBRATED_BASE,
						Math.max(this.speechThreshold, p90 * 2.5)
					);
					this.effectiveThreshold = this.calibratedBase * this.levelToMultiplier(this.sensitivityLevel);
					console.debug(`[VAD] Calibrated: noise floor p90=${p90.toFixed(4)}, base=${this.calibratedBase.toFixed(4)}, effective=${this.effectiveThreshold.toFixed(4)} (cap=${MAX_CALIBRATED_BASE})`);
					this.calibrationSamples = [];
				}
				this.animFrameId = requestAnimationFrame(tick);
				return;
			}

			if (!this.speaking) {
				if (level > this.effectiveThreshold) {
					this.speaking = true;
					this.speechStartMs = now;
					this.silenceStartMs = 0;
					this.capturing = true;
					this.speechSamples = [...this.preBuffer];
					this.preBuffer = [];
					this.callbacks?.onSpeechStart?.();
					this.setPhase('recording');
				}
			} else {
				if (level < this.effectiveThreshold) {
					if (this.silenceStartMs === 0) {
						this.silenceStartMs = now;
					} else if (now - this.silenceStartMs > this.silenceDurationMs) {
						const speechDuration = this.silenceStartMs - this.speechStartMs;
						this.speaking = false;
						this.capturing = false;

						if (speechDuration >= this.minSpeechDurationMs && this.speechSamples.length > 0) {
							this.emitSegment();
						} else {
							this.speechSamples = [];
							this.callbacks?.onNoiseDetected?.();
							this.setPhase('listening');
						}
					}
				} else {
					this.silenceStartMs = 0;
				}
			}

			this.animFrameId = requestAnimationFrame(tick);
		};

		this.animFrameId = requestAnimationFrame(tick);
	}

	private emitSegment() {
		const chunks = this.speechSamples;
		this.speechSamples = [];
		this.silenceStartMs = 0;
		this.setPhase('listening');

		if (chunks.length === 0) return;

		const wavBlob = this.samplesToWav(chunks);
		this.callbacks?.onSegmentReady?.(wavBlob, 'audio/wav');
	}

	private samplesToWav(chunks: Float32Array[]): Blob {
		const sampleRate = this.audioContext?.sampleRate ?? 16000;
		const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
		const pcm = new Int16Array(totalSamples);
		let offset = 0;
		for (const chunk of chunks) {
			for (let i = 0; i < chunk.length; i++) {
				const s = Math.max(-1, Math.min(1, chunk[i]));
				pcm[offset++] = s < 0 ? s * 32768 : s * 32767;
			}
		}

		const dataLen = pcm.byteLength;
		const wavBuf = new ArrayBuffer(44 + dataLen);
		const v = new DataView(wavBuf);
		const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
		w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true);
		w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
		v.setUint16(20, 1, true);             // PCM
		v.setUint16(22, 1, true);             // mono
		v.setUint32(24, sampleRate, true);    // sample rate
		v.setUint32(28, sampleRate * 2, true); // byte rate
		v.setUint16(32, 2, true);             // block align
		v.setUint16(34, 16, true);            // bits per sample
		w(36, 'data'); v.setUint32(40, dataLen, true);
		new Int16Array(wavBuf, 44).set(pcm);

		return new Blob([wavBuf], { type: 'audio/wav' });
	}

	private stopAmplitudeTick() {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
	}

	private releaseStream() {
		if (this.stream) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
		}
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
		this.analyser = null;
	}
}

export const vadService = new VadService();

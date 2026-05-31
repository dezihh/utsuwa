/**
 * Voice Activity Detection (VAD) service.
 *
 * Opens the microphone once and continuously monitors amplitude.
 * When speech is detected → starts buffering audio.
 * When silence is detected after speech → emits the recorded segment.
 *
 * Uses a rolling pre-buffer to capture audio just before speech onset.
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

class VadService {
	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private callbacks: VadCallbacks | null = null;
	private animFrameId: number | null = null;

	// Pre-buffer: rolling window of recent chunks before speech
	private preBuffer: Blob[] = [];
	private preBufferSlots = 3; // timeslice × slots = pre-buffer duration

	// Active speech segment chunks
	private speechChunks: Blob[] = [];
	private capturing = false; // true while recording a speech segment

	// The very first chunk from MediaRecorder contains the EBML/WebM container header.
	// Without it, the Blob is not a valid audio file. We keep it and prepend to every segment.
	private headerChunk: Blob | null = null;

	// VAD state
	private active = false;
	private phase: VadServicePhase = 'idle';
	private speaking = false;
	private speechStartMs = 0;
	private silenceStartMs = 0;

	// Noise floor calibration: measure ambient RMS for the first CALIBRATION_MS ms,
	// then dynamically set the effective threshold above the noise floor.
	private static readonly CALIBRATION_MS = 1500;
	private calibrating = false;
	private calibrationEndMs = 0;
	private calibrationSamples: number[] = [];
	private calibratedBase = 0.015; // noise-floor-derived threshold, set after calibration
	private effectiveThreshold = 0.015; // calibratedBase × sensitivityMultiplier

	// Sensitivity: 1.0 = default. Lower = more sensitive (catches quieter speech).
	// Adjusted live via setSensitivity(). Range enforced: 0.3 – 4.0.
	private sensitivityMultiplier = 1.0;

	// Config (user-supplied)
	private speechThreshold = 0.015;
	private silenceDurationMs = 1500;
	private minSpeechDurationMs = 500;
	private timesliceMs = 100;

	/** Adjust detection sensitivity at runtime. multiplier < 1 = more sensitive, > 1 = less. */
	setSensitivity(multiplier: number) {
		this.sensitivityMultiplier = Math.max(0.3, Math.min(4.0, multiplier));
		// Recompute effective threshold immediately (only after calibration is done)
		if (!this.calibrating) {
			this.effectiveThreshold = this.calibratedBase * this.sensitivityMultiplier;
		}
	}

	getSensitivity(): number {
		return this.sensitivityMultiplier;
	}

	async start(callbacks: VadCallbacks, config?: VadConfig): Promise<boolean> {
		if (this.active) return true;

		this.callbacks = callbacks;
		if (config?.speechThreshold !== undefined) this.speechThreshold = config.speechThreshold;
		if (config?.silenceDurationMs !== undefined) this.silenceDurationMs = config.silenceDurationMs;
		if (config?.minSpeechDurationMs !== undefined)
			this.minSpeechDurationMs = config.minSpeechDurationMs;
		if (config?.preBufferMs !== undefined) {
			this.preBufferSlots = Math.ceil(config.preBufferMs / this.timesliceMs);
		}

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
		const source = this.audioContext.createMediaStreamSource(this.stream);
		this.analyser = this.audioContext.createAnalyser();
		this.analyser.fftSize = 512;
		source.connect(this.analyser);

		this.startMediaRecorder();

		this.active = true;
		this.speaking = false;
		this.capturing = false;
		this.preBuffer = [];
		this.speechChunks = [];

		// Start calibration: measure ambient noise for CALIBRATION_MS before detecting speech
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
		this.stopMediaRecorder(false);
		this.releaseStream();
		this.setPhase('idle');
		this.callbacks = null;
		this.preBuffer = [];
		this.speechChunks = [];
		this.headerChunk = null;
	}

	private setPhase(p: VadServicePhase) {
		this.phase = p;
		this.callbacks?.onPhaseChange?.(p);
	}

	private startMediaRecorder() {
		if (!this.stream) return;
		const mimeType = this.getSupportedMimeType();
		try {
			this.mediaRecorder = mimeType
				? new MediaRecorder(this.stream, { mimeType })
				: new MediaRecorder(this.stream);
		} catch {
			this.callbacks?.onError?.('Audio recording not supported on this platform');
			return;
		}

		this.mediaRecorder.ondataavailable = (e) => {
			if (!e.data || e.data.size === 0) return;

			// The very first chunk contains the container header (EBML for WebM).
			// Save it so we can prepend it to every emitted segment.
			if (this.headerChunk === null) {
				this.headerChunk = e.data;
			}

			if (this.capturing) {
				this.speechChunks.push(e.data);
			} else {
				// Rolling pre-buffer
				this.preBuffer.push(e.data);
				if (this.preBuffer.length > this.preBufferSlots) {
					this.preBuffer.shift();
				}
			}
		};

		this.mediaRecorder.onstop = () => {
			// Reset header so the new recording session saves its own header chunk
			this.headerChunk = null;
			// Restart for continuous recording
			if (this.active) this.startMediaRecorder();
		};

		this.mediaRecorder.start(this.timesliceMs);
	}

	private stopMediaRecorder(restart: boolean) {
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			if (!restart) {
				// Prevent auto-restart
				this.mediaRecorder.onstop = null;
			}
			this.mediaRecorder.stop();
		}
		this.mediaRecorder = null;
	}

	private startAmplitudeTick() {
		if (!this.analyser) return;
		this.analyser.fftSize = 1024;
		const dataArray = new Uint8Array(this.analyser.fftSize);

		const tick = () => {
			if (!this.active || !this.analyser) return;

			// Time-domain RMS – much more reliable for speech detection than frequency average
			this.analyser.getByteTimeDomainData(dataArray);
			let sumSq = 0;
			for (let i = 0; i < dataArray.length; i++) {
				const sample = (dataArray[i] - 128) / 128;
				sumSq += sample * sample;
			}
			const level = Math.sqrt(sumSq / dataArray.length);

			this.callbacks?.onAudioLevel?.(level);

			const now = Date.now();

			// ── Calibration phase: collect ambient noise samples ─────────────────────
			if (this.calibrating) {
				this.calibrationSamples.push(level);
				if (now >= this.calibrationEndMs) {
					this.calibrating = false;
					// Compute 90th-percentile of ambient samples as noise floor
					const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
					const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
					// Base threshold = noise_floor × 3, but clamped between user-set minimum and a
					// reasonable max (0.08) so speech can always be detected even in noisy rooms.
					const MAX_CALIBRATED_BASE = 0.08;
					this.calibratedBase = Math.min(
						MAX_CALIBRATED_BASE,
						Math.max(this.speechThreshold, p90 * 3)
					);
					this.effectiveThreshold = this.calibratedBase * this.sensitivityMultiplier;
					console.debug(`[VAD] Calibrated: noise floor p90=${p90.toFixed(4)}, base=${this.calibratedBase.toFixed(4)}, effective=${this.effectiveThreshold.toFixed(4)} (cap=${MAX_CALIBRATED_BASE})`);
					this.calibrationSamples = [];
				}
				this.animFrameId = requestAnimationFrame(tick);
				return; // Don't detect speech during calibration
			}

			if (!this.speaking) {
				if (level > this.effectiveThreshold) {
					this.speaking = true;
					this.speechStartMs = now;
					this.silenceStartMs = 0;
					this.capturing = true;
					// Prepend pre-buffer to speech chunks
					this.speechChunks = [...this.preBuffer];
					this.preBuffer = [];
					this.callbacks?.onSpeechStart?.();
					this.setPhase('recording');
				}
			} else {
				if (level < this.effectiveThreshold) {
					if (this.silenceStartMs === 0) {
						this.silenceStartMs = now;
					} else if (now - this.silenceStartMs > this.silenceDurationMs) {
						// Silence long enough → emit segment
						const speechDuration = this.silenceStartMs - this.speechStartMs;
						this.speaking = false;
						this.capturing = false;

						if (speechDuration >= this.minSpeechDurationMs && this.speechChunks.length > 0) {
							this.emitSegment();
						} else {
							// Too short — likely noise/click. Notify caller.
							this.speechChunks = [];
							this.callbacks?.onNoiseDetected?.();
							this.setPhase('listening');
						}
					}
				} else {
					// Still speaking — reset silence timer
					this.silenceStartMs = 0;
				}
			}

			this.animFrameId = requestAnimationFrame(tick);
		};

		this.animFrameId = requestAnimationFrame(tick);
	}

	private emitSegment() {
		const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
		// Always prepend the header chunk so the blob is a valid, standalone audio file.
		const chunks = this.headerChunk
			? [this.headerChunk, ...this.speechChunks]
			: this.speechChunks;
		const blob = new Blob(chunks, { type: mimeType });
		this.speechChunks = [];
		this.silenceStartMs = 0;
		this.setPhase('listening');
		this.callbacks?.onSegmentReady?.(blob, mimeType);
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

	private getSupportedMimeType(): string | undefined {
		const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
		for (const type of types) {
			if (MediaRecorder.isTypeSupported(type)) return type;
		}
		return undefined;
	}
}

export const vadService = new VadService();

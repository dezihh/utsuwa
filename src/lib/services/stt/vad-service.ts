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
	onError?: (message: string) => void;
}

export interface VadConfig {
	/** Normalized RMS amplitude threshold to detect speech. Default: 0.025 */
	speechThreshold?: number;
	/** Milliseconds of silence after speech to end the segment. Default: 1500 */
	silenceDurationMs?: number;
	/** Minimum speech duration (ms) to emit a segment. Shorter bursts are discarded. Default: 400 */
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

	// VAD state
	private active = false;
	private phase: VadServicePhase = 'idle';
	private speaking = false;
	private speechStartMs = 0;
	private silenceStartMs = 0;

	// Config
	private speechThreshold = 0.025;
	private silenceDurationMs = 1500;
	private minSpeechDurationMs = 400;
	private timesliceMs = 100;

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
		this.setPhase('listening');
		this.startAmplitudeTick();
		return true;
	}

	stop(): void {
		this.active = false;
		this.speaking = false;
		this.capturing = false;
		this.stopAmplitudeTick();
		this.stopMediaRecorder(false);
		this.releaseStream();
		this.setPhase('idle');
		this.callbacks = null;
		this.preBuffer = [];
		this.speechChunks = [];
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
		const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

		const tick = () => {
			if (!this.active || !this.analyser) return;

			this.analyser.getByteFrequencyData(dataArray);
			let sum = 0;
			for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
			const level = sum / (dataArray.length * 255);

			this.callbacks?.onAudioLevel?.(level);

			const now = Date.now();

			if (!this.speaking) {
				if (level > this.speechThreshold) {
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
				if (level < this.speechThreshold) {
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
							this.speechChunks = [];
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
		const blob = new Blob(this.speechChunks, { type: mimeType });
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

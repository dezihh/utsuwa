import type { SpeechRecognitionCallbacks } from './web-speech';

class WhisperLocalSttService {
	private baseUrl: string = 'http://127.0.0.1:8000/v1';
	private model: string = 'deepdml/faster-whisper-large-v3-turbo-ct2';
	private mediaRecorder: MediaRecorder | null = null;
	private audioChunks: Blob[] = [];
	private stream: MediaStream | null = null;
	private analyser: AnalyserNode | null = null;
	private audioContext: AudioContext | null = null;
	private animFrameId: number | null = null;
	private callbacks: SpeechRecognitionCallbacks | null = null;
	private abortController: AbortController | null = null;
	private listening = false;
	private transcribing = false;

	configure(options: { baseUrl?: string; model?: string }) {
		if (options.baseUrl?.trim()) this.baseUrl = options.baseUrl.trim().replace(/\/$/, '');
		if (options.model) this.model = options.model;
	}

	isSupported(): boolean {
		return !!navigator.mediaDevices?.getUserMedia;
	}

	isConfigured(): boolean {
		return true; // No API key required
	}

	getIsListening(): boolean {
		return this.listening;
	}

	getIsTranscribing(): boolean {
		return this.transcribing;
	}

	async startListening(callbacks: SpeechRecognitionCallbacks): Promise<boolean> {
		if (this.listening) return true;

		this.callbacks = callbacks;
		this.audioChunks = [];

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			if (err instanceof DOMException) {
				const messages: Record<string, string> = {
					NotAllowedError: 'Microphone access denied. Check system permissions.',
					NotFoundError: 'No microphone found. Please connect a microphone.',
					NotReadableError: 'Microphone is busy or in use by another app.',
					OverconstrainedError: 'Microphone does not meet requirements.'
				};
				callbacks.onError(messages[err.name] || `Microphone error: ${err.message}`);
			} else {
				callbacks.onError('Failed to access microphone');
			}
			return false;
		}

		this.stream.getTracks().forEach((track) => {
			track.onended = () => {
				if (this.listening) {
					this.callbacks?.onError('Microphone disconnected');
					this.cleanup();
					this.listening = false;
					this.callbacks?.onEnd();
				}
			};
		});

		this.audioContext = new AudioContext();
		const source = this.audioContext.createMediaStreamSource(this.stream);
		this.analyser = this.audioContext.createAnalyser();
		this.analyser.fftSize = 256;
		source.connect(this.analyser);
		this.startLevelMonitoring();

		const mimeType = this.getSupportedMimeType();
		try {
			this.mediaRecorder = mimeType
				? new MediaRecorder(this.stream, { mimeType })
				: new MediaRecorder(this.stream);
		} catch (err) {
			callbacks.onError('Audio recording not supported on this platform');
			this.releaseStream();
			return false;
		}

		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.audioChunks.push(e.data);
		};

		this.mediaRecorder.onstop = () => this.handleRecordingStop();
		this.mediaRecorder.start(250);
		this.listening = true;
		return true;
	}

	stopListening(): void {
		if (this.mediaRecorder && this.listening) {
			this.mediaRecorder.stop();
		}
	}

	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.callbacks = null;
		this.cleanup();
		this.listening = false;
		this.transcribing = false;
	}

	private getSupportedMimeType(): string | undefined {
		const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
		for (const type of types) {
			if (MediaRecorder.isTypeSupported(type)) return type;
		}
		return undefined;
	}

	private startLevelMonitoring() {
		if (!this.analyser || !this.callbacks?.onAudioLevel) return;

		const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
		const tick = () => {
			if (!this.analyser || !this.listening) return;
			this.analyser.getByteFrequencyData(dataArray);
			let sum = 0;
			for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
			const level = sum / (dataArray.length * 255);
			this.callbacks?.onAudioLevel?.(level);
			this.animFrameId = requestAnimationFrame(tick);
		};
		this.animFrameId = requestAnimationFrame(tick);
	}

	private async handleRecordingStop() {
		this.listening = false;
		this.stopLevelMonitoring();
		this.releaseStream();

		if (!this.callbacks) return;

		if (this.audioChunks.length === 0) {
			this.callbacks?.onEnd();
			return;
		}

		this.transcribing = true;
		const actualMime = this.mediaRecorder?.mimeType || 'audio/mp4';
		const audioBlob = new Blob(this.audioChunks, { type: actualMime });
		this.audioChunks = [];

		const ext = actualMime.includes('webm') ? 'webm' : actualMime.includes('ogg') ? 'ogg' : 'm4a';

		this.abortController = new AbortController();
		const timeoutId = setTimeout(() => this.abortController?.abort(), 60000);

		try {
			const formData = new FormData();
			formData.append('file', audioBlob, `recording.${ext}`);
			formData.append('model', this.model);
			formData.append('baseUrl', this.baseUrl);

			// Route through the SvelteKit server so that localhost:8000 is reachable
			// (the server runs in Docker with network_mode: host)
			const response = await fetch('/api/stt', {
				method: 'POST',
				body: formData,
				signal: this.abortController.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const msg =
					(errorData as { error?: string })?.error || `Whisper error (${response.status})`;
				this.callbacks?.onError(msg);
				this.transcribing = false;
				return;
			}

			const data = (await response.json()) as { text: string };
			const text = data.text?.trim();
			this.transcribing = false;

			if (text) {
				this.callbacks?.onResult(text, true);
			}
			this.callbacks?.onEnd();
		} catch (err) {
			clearTimeout(timeoutId);
			this.transcribing = false;
			if (err instanceof DOMException && err.name === 'AbortError') {
				this.callbacks?.onEnd();
				return;
			}
			const msg = err instanceof Error ? err.message : 'Failed to transcribe audio';
			this.callbacks?.onError(msg);
		} finally {
			this.abortController = null;
		}
	}

	private stopLevelMonitoring() {
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

	private cleanup() {
		this.stopLevelMonitoring();
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			this.mediaRecorder.stop();
		}
		this.mediaRecorder = null;
		this.audioChunks = [];
		this.releaseStream();
	}
}

export const whisperLocalSttService = new WhisperLocalSttService();

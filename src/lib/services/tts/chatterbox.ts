import {
        getSharedAudioContext,
        type ITTSProvider,
        type TTSOptions,
        type TTSSpeakResult,
        type TTSCapabilities,
        type StreamOptions,
        type AudioChunk
} from './index';

/**
 * ChatterboxTTS — WebSocket-based streaming TTS provider for chatterbox-ng.
 *
 * Protocol:
 * 1. Client opens WebSocket to /ws/tts (via server proxy)
 * 2. Client sends JSON params (text, language_id, exaggeration, etc.)
 * 3. Server sends JSON {"status": "generating", "sample_rate": 24000}
 * 4. Server sends binary frames (raw float32 PCM at sample_rate)
 * 5. Server sends JSON {"status": "done"}
 *
 * This enables true streaming: audio plays as soon as first chunk arrives (~173ms).
 */
export class ChatterboxTTS implements ITTSProvider {
        private voiceId: string;
        private speed: number;
        private baseUrl: string;
        private exaggeration: number;
        private language: string | undefined;
        private cfgWeight: number | undefined;
        private temperature: number | undefined;

        readonly capabilities: TTSCapabilities = {
                streaming: true,
                emotion: true,
                multilingual: true
        };

        constructor(options: TTSOptions) {
                this.voiceId = options.voiceId || '';
                this.speed = options.speed ?? 1;
                this.baseUrl = (options.baseUrl || 'http://localhost:8765/').replace(/\/+$/, '');
                this.exaggeration = options.exaggeration ?? 0.4;
                this.language = options.language;
                this.cfgWeight = options.cfgWeight;
                this.temperature = options.temperature;
        }

        getAudioContext(): AudioContext {
                return getSharedAudioContext();
        }

        /**
         * Non-streaming speak: generates full audio via WebSocket, then plays.
         */
        async speak(text: string): Promise<TTSSpeakResult> {
                const audioBuffer = await this.fetchAudioBuffer(text);
                const audioContext = this.getAudioContext();

                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;

                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;

                source.connect(analyser);
                analyser.connect(audioContext.destination);
                source.start(0);

                return { source, analyser };
        }

        /**
         * Fetch full audio as AudioBuffer (used by sentence-pipelining orchestrator).
         */
        async fetchAudioBuffer(text: string, options?: StreamOptions): Promise<AudioBuffer> {
                const audioContext = this.getAudioContext();
                if (audioContext.state === 'suspended') await audioContext.resume();

                const chunks: Uint8Array[] = [];
                let sampleRate = 24000;
                let headerSent = false;

                const wsUrl = this.getWebSocketUrl();

                await new Promise<void>((resolve, reject) => {
                        const ws = new WebSocket(wsUrl);

                        ws.onopen = () => {
                                ws.send(JSON.stringify(this.buildParams(text, options)));
                        };

                        ws.onmessage = (event) => {
                                if (event.data instanceof Blob) {
                                        event.data.arrayBuffer().then(buf => {
                                                const pcm16 = this.float32ToPcm16(new Float32Array(buf));
                                                const wavChunk = headerSent
                                                        ? pcm16
                                                        : this.prependWavHeader(pcm16, sampleRate);
                                                headerSent = true;
                                                chunks.push(wavChunk);
                                        });
                                } else {
                                        const msg = JSON.parse(event.data as string);
                                        if (msg.sample_rate) sampleRate = msg.sample_rate;
                                        if (msg.status === 'done') { ws.close(); resolve(); }
                                        if (msg.error) { ws.close(); reject(new Error(msg.error)); }
                                }
                        };

                        ws.onerror = () => reject(new Error('WebSocket connection failed'));
                        ws.onclose = () => resolve();
                });

                const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const c of chunks) { combined.set(c, offset); offset += c.length; }
                return audioContext.decodeAudioData(combined.buffer.slice(0));
        }

        /**
         * True streaming: yields audio chunks as they arrive via WebSocket.
         */
        async *speakStreaming(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk> {
                const wsUrl = this.getWebSocketUrl();
                const abortSignal = options?.signal;

                const ws = new WebSocket(wsUrl);
                let sampleRate = 24000;
                let headerSent = false;

                // Queue for incoming data
                const queue: (ArrayBuffer | 'done' | Error)[] = [];
                let resolve: (() => void) | null = null;

                function notify() { if (resolve) { resolve(); resolve = null; } }

                ws.onopen = () => {
                        ws.send(JSON.stringify(this.buildParams(text, options)));
                };

                ws.onmessage = (event) => {
                        if (event.data instanceof Blob) {
                                event.data.arrayBuffer().then(buf => {
                                        queue.push(buf);
                                        notify();
                                });
                        } else {
                                const msg = JSON.parse(event.data as string);
                                if (msg.sample_rate) sampleRate = msg.sample_rate;
                                if (msg.status === 'done') { queue.push('done'); notify(); }
                                if (msg.error) { queue.push(new Error(msg.error)); notify(); }
                        }
                };

                ws.onerror = () => { queue.push(new Error('WebSocket error')); notify(); };

                // Handle abort
                if (abortSignal) {
                        abortSignal.addEventListener('abort', () => {
                                ws.close();
                                queue.push('done');
                                notify();
                        }, { once: true });
                }

                try {
                        while (true) {
                                if (abortSignal?.aborted) return;

                                if (queue.length === 0) {
                                        await new Promise<void>(r => { resolve = r; });
                                }

                                const item = queue.shift();
                                if (!item || item === 'done') {
                                        yield { data: new ArrayBuffer(0), done: true };
                                        return;
                                }
                                if (item instanceof Error) {
                                        throw item;
                                }

                                const pcm16 = this.float32ToPcm16(new Float32Array(item));
                                yield {
                                        data: headerSent
                                                ? pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength)
                                                : this.prependWavHeader(pcm16, sampleRate),
                                        done: false
                                };
                                headerSent = true;
                        }
                } finally {
                        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                                ws.close();
                        }
                }
        }

        private getWebSocketUrl(): string {
               const normalizedBase = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
               const url = new URL('ws/tts', normalizedBase);
               url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
               return url.toString().replace(/\/$/, '');
        }

        private buildParams(text: string, options?: StreamOptions): Record<string, unknown> {
                const audioContext = this.getAudioContext();
                const params: Record<string, unknown> = {
                        text,
                        output_sample_rate: audioContext.sampleRate, // ← statt hardcoded 24000
                        chunk_tokens: 25,
                        exaggeration: options?.exaggeration ?? this.exaggeration,
                        cfg_weight: this.cfgWeight ?? 0.5,
                        temperature: this.temperature ?? 0.5,
                };
                const language = options?.language ?? this.language;
                if (language) params.language_id = language;

                // Voice: resolve path for the container
                if (this.voiceId) {
                        if (this.voiceId.startsWith('clone:')) {
                                params.audio_prompt_path = `/app/reference_audio/${this.voiceId.slice(6)}.wav`;
                        } else {
                                params.audio_prompt_path = `/app/voices/${this.voiceId}.wav`;
                        }
                }

                return params;
        }

        private float32ToPcm16(samples: Float32Array): Uint8Array {
                const bytes = new Uint8Array(samples.length * 2);
                const view = new DataView(bytes.buffer);
                for (let i = 0; i < samples.length; i++) {
                        const s = Math.max(-1, Math.min(1, samples[i]));
                        view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
                }
                return bytes;
        }

        /**
         * Create a minimal PCM16 WAV buffer from raw PCM bytes.
         */
        private prependWavHeader(pcm16: Uint8Array, sampleRate: number): ArrayBuffer {
                const numChannels = 1;
                const bitsPerSample = 16;
                const bytesPerSample = bitsPerSample / 8;
                const dataSize = pcm16.byteLength;
                const buffer = new ArrayBuffer(44 + dataSize);
                const view = new DataView(buffer);

                // WAV header
                const writeString = (offset: number, str: string) => {
                        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
                };

                writeString(0, 'RIFF');
                view.setUint32(4, 36 + dataSize, true);
                writeString(8, 'WAVE');
                writeString(12, 'fmt ');
                view.setUint32(16, 16, true); // chunk size
                view.setUint16(20, 3, true);  // format: IEEE float
                view.setUint16(22, numChannels, true);
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
                view.setUint16(32, numChannels * bytesPerSample, true);
                view.setUint16(34, bitsPerSample, true);
                writeString(36, 'data');
                view.setUint32(40, dataSize, true);

                new Uint8Array(buffer, 44).set(pcm16);

                return buffer;
        }
}

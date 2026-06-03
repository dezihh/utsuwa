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
 * ChatterboxTTS — server-proxied streaming TTS provider for chatterbox-ng.
 *
 * The browser posts to the same-origin /api/tts/chatterbox/stream endpoint,
 * and the server forwards the request to chatterbox-ng. This avoids direct
 * browser connections to localhost:8765, which do not work reliably on iOS/
 * Safari devices and remote clients.
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
         * Non-streaming speak: fetches the streamed WAV response, then plays.
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

                const response = await this.requestStream(text, options);
                if (!response.ok) {
                        const message = await response.text().catch(() => '');
                        throw new Error(`Chatterbox TTS error: ${response.status} ${message}`);
                }

                const combined = response.body
                        ? await this.readStreamToBuffer(response.body)
                        : await response.arrayBuffer();
                return audioContext.decodeAudioData(combined.slice(0));
        }

        /**
         * True streaming: yields audio chunks as they arrive from the server stream.
         */
        async *speakStreaming(text: string, options?: StreamOptions): AsyncGenerator<AudioChunk> {
                const abortSignal = options?.signal;
                const response = await this.requestStream(text, options);
                if (!response.ok) {
                        const message = await response.text().catch(() => '');
                        throw new Error(`Chatterbox TTS error: ${response.status} ${message}`);
                }

                if (!response.body) {
                        yield { data: await response.arrayBuffer(), done: false };
                        yield { data: new ArrayBuffer(0), done: true };
                        return;
                }

                const reader = response.body.getReader();
                try {
                        while (true) {
                                if (abortSignal?.aborted) return;

                                const { value, done } = await reader.read();
                                if (done) {
                                        yield { data: new ArrayBuffer(0), done: true };
                                        return;
                                }

                                if (value && value.byteLength > 0) {
                                        yield {
                                                data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
                                                done: false
                                        };
                                }
                        }
                } finally {
                        reader.releaseLock();
                }
        }

        private async requestStream(text: string, options?: StreamOptions): Promise<Response> {
                return fetch('/api/tts/chatterbox/stream', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                ...this.buildParams(text, options),
                                baseUrl: this.baseUrl
                        }),
                        signal: options?.signal
                });
        }

        private buildParams(text: string, options?: StreamOptions): Record<string, unknown> {
                const params: Record<string, unknown> = {
                        text,
                        output_sample_rate: 24000,
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

        private async readStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
                const reader = stream.getReader();
                const chunks: Uint8Array[] = [];
                let total = 0;

                try {
                        while (true) {
                                const { value, done } = await reader.read();
                                if (done) break;
                                if (!value || value.byteLength === 0) continue;
                                chunks.push(value);
                                total += value.byteLength;
                        }
                } finally {
                        reader.releaseLock();
                }

                const combined = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.byteLength;
                }
                return combined.buffer;
        }
}

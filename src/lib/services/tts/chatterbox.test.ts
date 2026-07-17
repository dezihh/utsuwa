import test from 'node:test';
import assert from 'node:assert/strict';

// Mock AudioContext before importing the provider.
class MockAudioBufferSourceNode {
	buffer: AudioBuffer | null = null;
	onended: (() => void) | null = null;
	start() {
		setImmediate(() => this.onended?.());
	}
	stop() {}
	connect() {
		return this;
	}
	disconnect() {}
}

class MockAnalyserNode {
	fftSize = 256;
	connect() {
		return this;
	}
	disconnect() {}
}

class MockAudioContext {
	state = 'running';
	destination = {};
	createBufferSource() {
		return new MockAudioBufferSourceNode() as unknown as AudioBufferSourceNode;
	}
	createAnalyser() {
		return new MockAnalyserNode() as unknown as AnalyserNode;
	}
	createBuffer(numChannels: number, length: number, sampleRate: number) {
		return {
			duration: length / sampleRate,
			getChannelData: () => new Float32Array(length),
			numberOfChannels: numChannels,
			sampleRate,
			length
		} as unknown as AudioBuffer;
	}
	async decodeAudioData() {
		return this.createBuffer(1, 480, 48000);
	}
	resume() {
		return Promise.resolve();
	}
}

// @ts-expect-error globalThis.AudioContext is not available in Node test environment
globalThis.AudioContext = MockAudioContext;

import { ChatterboxTTS } from './chatterbox.ts';

function createStreamResponse(chunks: ArrayBuffer[]): Response {
	let chunkIndex = 0;
	const stream = new ReadableStream({
		pull(controller) {
			if (chunkIndex < chunks.length) {
				controller.enqueue(new Uint8Array(chunks[chunkIndex++]));
			} else {
				controller.close();
			}
		}
	});
	return {
		ok: true,
		status: 200,
		body: stream,
		headers: new Headers()
	} as unknown as Response;
}

test('speakStreaming sends text, baseUrl, and optional parameters', async () => {
	const fetchCalls: { url: string; body: Record<string, unknown> }[] = [];
	// @ts-expect-error global fetch mock
	globalThis.fetch = (url: string, init: RequestInit) => {
		fetchCalls.push({ url, body: JSON.parse(init.body as string) });
		return createStreamResponse([new ArrayBuffer(8), new ArrayBuffer(8)]);
	};

	const provider = new ChatterboxTTS({
		provider: 'chatterbox-ng',
		baseUrl: 'http://localhost:8765/',
		voiceId: 'Abigail',
		exaggeration: 0.8,
		cfgWeight: 0.7,
		temperature: 0.6
	});

	const chunks: ArrayBuffer[] = [];
	for await (const chunk of provider.speakStreaming('Hello world', { language: 'en' })) {
		if (!chunk.done) chunks.push(chunk.data);
	}

	assert.equal(fetchCalls.length, 1);
	assert.equal(fetchCalls[0].url, '/api/tts/chatterbox/stream');
	assert.equal(fetchCalls[0].body.text, 'Hello world');
	assert.equal(fetchCalls[0].body.voice, 'Abigail');
	assert.equal(fetchCalls[0].body.language, 'en');
	assert.equal(fetchCalls[0].body.baseUrl, 'http://localhost:8765/');
	assert.equal(fetchCalls[0].body.exaggeration, 0.8);
	assert.equal(fetchCalls[0].body.cfg_weight, 0.7);
	assert.equal(fetchCalls[0].body.temperature, 0.6);
	assert.equal(chunks.length, 2);
});

test('speakStreaming omits unset optional parameters', async () => {
	const fetchCalls: { body: Record<string, unknown> }[] = [];
	// @ts-expect-error global fetch mock
	globalThis.fetch = (_url: string, init: RequestInit) => {
		fetchCalls.push({ body: JSON.parse(init.body as string) });
		return createStreamResponse([]);
	};

	const provider = new ChatterboxTTS({
		provider: 'chatterbox-ng',
		baseUrl: 'http://localhost:8765/'
	});

	for await (const _chunk of provider.speakStreaming('Hi')) {
		/* consume */
	}

	assert.equal('exaggeration' in fetchCalls[0].body, false);
	assert.equal('cfg_weight' in fetchCalls[0].body, false);
	assert.equal('temperature' in fetchCalls[0].body, false);
	assert.equal(fetchCalls[0].body.voice, 'default');
});

test('speakStreaming throws on non-OK response', async () => {
	globalThis.fetch = () =>
		Promise.resolve({
			ok: false,
			status: 502,
			text: () => Promise.resolve('Proxy error')
		} as Response);

	const provider = new ChatterboxTTS({ provider: 'chatterbox-ng' });

	await assert.rejects(
		async () => {
			for await (const _chunk of provider.speakStreaming('Hi')) {
				/* consume */
			}
		},
	/proxy error/i
	);
});

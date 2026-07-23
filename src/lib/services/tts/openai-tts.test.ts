import test from 'node:test';
import assert from 'node:assert/strict';
import type { TTSOptions, StreamOptions } from './index.ts';
import { OpenAITTS, buildOpenAITTSRequestBody } from './openai-tts.ts';

const omnivoiceOpts: TTSOptions = {
	provider: 'omnivoice',
	voiceId: 'alloy',
	model: 'omnivoice'
};

const openaiOpts: TTSOptions = {
	provider: 'openai-tts',
	voiceId: 'alloy',
	model: 'tts-1'
};

// ── buildOpenAITTSRequestBody ──────────────────────────────

test('sends instructions when provider is omnivoice and instructions is set', () => {
	const body = buildOpenAITTSRequestBody(
		'omnivoice',
		'omnivoice',
		'alloy',
		1,
		'Hello.',
		{ instructions: 'female, british accent' }
	);
	assert.equal(body.instructions, 'female, british accent');
	assert.equal(body.response_format, 'wav');
});

test('does not send instructions when provider is omnivoice and instructions is unset', () => {
	const body = buildOpenAITTSRequestBody('omnivoice', 'omnivoice', 'alloy', 1, 'Hello.');
	assert.equal('instructions' in body, false);
});

test('does not send instructions when provider is openai-tts even if instructions is set', () => {
	const body = buildOpenAITTSRequestBody(
		'openai-tts',
		'tts-1',
		'alloy',
		1,
		'Hello.',
		{ instructions: 'female, british accent' }
	);
	assert.equal('instructions' in body, false);
	assert.equal(body.response_format, 'mp3');
});

test('does not send instructions when instructions is empty string', () => {
	const body = buildOpenAITTSRequestBody(
		'omnivoice',
		'omnivoice',
		'alloy',
		1,
		'Hello.',
		{ instructions: '' }
	);
	assert.equal('instructions' in body, false);
});

test('response_format is wav for omnivoice and mp3 for other providers', () => {
	assert.equal(buildOpenAITTSRequestBody('omnivoice', 'omnivoice', 'alloy', 1, 'Hi').response_format, 'wav');
	assert.equal(buildOpenAITTSRequestBody('openai-tts', 'tts-1', 'alloy', 1, 'Hi').response_format, 'mp3');
	assert.equal(
		buildOpenAITTSRequestBody('local-tts', 'kokoro', 'af_bella', 1, 'Hi').response_format,
		'mp3'
	);
});

test('uses streamOptions voiceId override when provided', () => {
	const body = buildOpenAITTSRequestBody('omnivoice', 'omnivoice', 'alloy', 1, 'Hello.', {
		voiceId: 'onyx'
	});
	assert.equal(body.voice, 'onyx');
});

test('sends OmniVoice quality params only for omnivoice', () => {
	const opts: StreamOptions = {
		numStep: 16,
		positionTemperature: 3,
		classTemperature: 0.5
	};
	const omnivoiceBody = buildOpenAITTSRequestBody('omnivoice', 'omnivoice', 'alloy', 1, 'Hi', opts);
	assert.equal(omnivoiceBody.num_step, 16);
	assert.equal(omnivoiceBody.position_temperature, 3);
	assert.equal(omnivoiceBody.class_temperature, 0.5);

	const openaiBody = buildOpenAITTSRequestBody('openai-tts', 'tts-1', 'alloy', 1, 'Hi', opts);
	assert.equal('num_step' in openaiBody, false);
	assert.equal('position_temperature' in openaiBody, false);
	assert.equal('class_temperature' in openaiBody, false);
});

// ── fetchAudioBuffer integration ───────────────────────────

function setupAudioContextMock() {
	const originalAudioContext = globalThis.AudioContext;
	const originalFetch = globalThis.fetch;

	const mockBuffer = {
		sampleRate: 24000,
		length: 24000,
		duration: 1,
		numberOfChannels: 1,
		getChannelData: () => new Float32Array(24000)
	} as unknown as AudioBuffer;

	const mockContext = {
		state: 'running',
		resume: async () => { },
		decodeAudioData: async () => mockBuffer,
		createBufferSource: () => ({
			buffer: null,
			connect: () => { },
			start: () => { },
			onended: null
		}),
		createAnalyser: () => ({
			fftSize: 256,
			connect: () => { }
		}),
		destination: {}
	} as unknown as AudioContext;

	globalThis.AudioContext = function () {
		return mockContext;
	} as unknown as typeof AudioContext;

	return {
		mockBuffer,
		mockContext,
		restore: () => {
			globalThis.AudioContext = originalAudioContext;
			globalThis.fetch = originalFetch;
		}
	};
}

function mockFetchResponse(status: number, body: BodyInit | null, ok: boolean): Response {
	return {
		ok,
		status,
		arrayBuffer: async () => {
			if (body === null) return new ArrayBuffer(0);
			if (body instanceof ArrayBuffer) return body;
			if (body instanceof Blob) return body.arrayBuffer();
			return new TextEncoder().encode(String(body)).buffer;
		},
		json: async () => JSON.parse(String(body))
	} as unknown as Response;
}

test('fetchAudioBuffer sends correct body for omnivoice', async () => {
	const { restore } = setupAudioContextMock();
	let capturedBody: Record<string, unknown> | undefined;
	let capturedUrl: string | undefined;

	globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
		capturedUrl = String(url);
		capturedBody = JSON.parse(init?.body as string);
		return mockFetchResponse(200, new ArrayBuffer(0), true);
	};

	try {
		const tts = new OpenAITTS(omnivoiceOpts);
		await tts.fetchAudioBuffer('Hello.', { instructions: 'female, british accent' });

		assert.equal(capturedUrl, 'http://localhost:8880/v1/audio/speech');
		assert.equal(capturedBody?.model, 'omnivoice');
		assert.equal(capturedBody?.input, 'Hello.');
		assert.equal(capturedBody?.voice, 'alloy');
		assert.equal(capturedBody?.instructions, 'female, british accent');
		assert.equal(capturedBody?.response_format, 'wav');
	} finally {
		restore();
	}
});

test('fetchAudioBuffer does not send Authorization header for local providers without key', async () => {
	const { restore } = setupAudioContextMock();
	let capturedInit: RequestInit | undefined;

	globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
		capturedInit = init;
		return mockFetchResponse(200, new ArrayBuffer(0), true);
	};

	try {
		const tts = new OpenAITTS(omnivoiceOpts);
		await tts.fetchAudioBuffer('Hello.');
		assert.equal('Authorization' in (capturedInit?.headers as Record<string, string>), false);
	} finally {
		restore();
	}
});

test('fetchAudioBuffer sends Authorization header when apiKey is set', async () => {
	const { restore } = setupAudioContextMock();
	let capturedInit: RequestInit | undefined;

	globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
		capturedInit = init;
		return mockFetchResponse(200, new ArrayBuffer(0), true);
	};

	try {
		const tts = new OpenAITTS({ ...openaiOpts, apiKey: 'sk-test' });
		await tts.fetchAudioBuffer('Hello.');
		assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer sk-test');
	} finally {
		restore();
	}
});

test('fetchAudioBuffer throws on local server error', async () => {
	const { restore } = setupAudioContextMock();

	globalThis.fetch = async () => mockFetchResponse(500, JSON.stringify({ error: 'boom' }), false);

	try {
		const tts = new OpenAITTS(omnivoiceOpts);
		await assert.rejects(async () => tts.fetchAudioBuffer('Hello.'), /Local TTS server returned 500/);
	} finally {
		restore();
	}
});

test('fetchAudioBuffer throws helpful hint on connection failure for local provider', async () => {
	const { restore } = setupAudioContextMock();

	globalThis.fetch = async () => {
		throw new Error('Connection refused');
	};

	try {
		const tts = new OpenAITTS(omnivoiceOpts);
		await assert.rejects(async () => tts.fetchAudioBuffer('Hello.'), /OmniVoice/);
	} finally {
		restore();
	}
});

// ── Multilingual voice consistency ─────────────────────────

test('voice stays stable across language switches (same voiceId, different language)', async () => {
	const { restore } = setupAudioContextMock();
	const capturedBodies: Record<string, unknown>[] = [];

	globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
		capturedBodies.push(JSON.parse(init?.body as string));
		return mockFetchResponse(200, new ArrayBuffer(0), true);
	};

	try {
		const tts = new OpenAITTS(omnivoiceOpts);

		// Simulate a multilingual sequence: de → es → de
		await tts.fetchAudioBuffer('Hallo Welt.', { language: 'de' });
		await tts.fetchAudioBuffer('Hola mundo.', { language: 'es' });
		await tts.fetchAudioBuffer('Noch ein Satz.', { language: 'de' });

		assert.equal(capturedBodies.length, 3);
		// Voice must remain the same across all requests
		assert.equal(capturedBodies[0].voice, 'alloy');
		assert.equal(capturedBodies[1].voice, 'alloy');
		assert.equal(capturedBodies[2].voice, 'alloy');
		// Language changes per sentence
		assert.equal(capturedBodies[0].language, 'de');
		assert.equal(capturedBodies[1].language, 'es');
		assert.equal(capturedBodies[2].language, 'de');
	} finally {
		restore();
	}
});

test('buildOpenAITTSRequestBody sends language from streamOptions for omnivoice', () => {
	const body = buildOpenAITTSRequestBody('omnivoice', 'omnivoice', 'alloy', 1, 'Hola.', {
		language: 'es'
	});
	assert.equal(body.voice, 'alloy');
	assert.equal(body.language, 'es');
});

test('buildOpenAITTSRequestBody does not send language for non-omnivoice', () => {
	const body = buildOpenAITTSRequestBody('openai-tts', 'tts-1', 'alloy', 1, 'Hello.', {
		language: 'en'
	});
	assert.equal('language' in body, false);
});

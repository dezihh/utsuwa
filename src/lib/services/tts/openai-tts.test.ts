import test from 'node:test';
import assert from 'node:assert/strict';
import type { TTSOptions } from './index.ts';

// Mock OpenAITTS is tested through fetchAudioBuffer's request body.
// We test the body construction logic in isolation since AudioContext
// isn't available in the Node test runner.

function buildBody(opts: TTSOptions, text: string, instructions?: string): Record<string, unknown> {
	const isOmnivoice = opts.provider === 'omnivoice';
	const body: Record<string, unknown> = {
		model: opts.model || 'tts-1',
		input: text,
		voice: opts.voiceId || 'alloy',
		speed: opts.speed ?? 1,
		response_format: isOmnivoice ? 'wav' : 'mp3'
	};
	if (isOmnivoice && instructions) {
		body.instructions = instructions;
	}
	return body;
}

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

test('sends instructions when provider is omnivoice and instructions is set', () => {
	const body = buildBody(omnivoiceOpts, 'Hello.', 'female, british accent');
	assert.equal(body.instructions, 'female, british accent');
	assert.equal(body.response_format, 'wav');
});

test('does not send instructions when provider is omnivoice and instructions is unset', () => {
	const body = buildBody(omnivoiceOpts, 'Hello.');
	assert.equal('instructions' in body, false);
});

test('does not send instructions when provider is openai-tts even if instructions is set', () => {
	const body = buildBody(openaiOpts, 'Hello.', 'female, british accent');
	assert.equal('instructions' in body, false);
	assert.equal(body.response_format, 'mp3');
});

test('does not send instructions when instructions is empty string', () => {
	const body = buildBody(omnivoiceOpts, 'Hello.', '');
	assert.equal('instructions' in body, false);
});

test('response_format is wav for omnivoice and mp3 for other providers', () => {
	assert.equal(buildBody(omnivoiceOpts, 'Hi').response_format, 'wav');
	assert.equal(buildBody(openaiOpts, 'Hi').response_format, 'mp3');
	assert.equal(
		buildBody({ provider: 'local-tts', voiceId: 'af_bella' }, 'Hi').response_format,
		'mp3'
	);
});
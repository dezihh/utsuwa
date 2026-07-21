import test from 'node:test';
import assert from 'node:assert/strict';
import { getTTSProvider } from './index.ts';
import type { TTSOptions } from './index.ts';

const baseOmniOptions: TTSOptions = {
	provider: 'omnivoice',
	voiceId: 'alloy',
	model: 'omnivoice',
	baseUrl: 'http://localhost:8880/v1/',
	speed: 1,
	instructions: 'female, young adult',
	altVoiceId: 'onyx',
	altInstructions: 'male, middle-aged',
	numStep: 32,
	altNumStep: 32,
	positionTemperature: 5,
	classTemperature: 0
};

test('getTTSProvider returns the same instance for identical options', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider(baseOmniOptions);
	assert.equal(a, b);
});

test('getTTSProvider creates a new instance when instructions change', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, instructions: 'male, elderly' });
	assert.notEqual(a, b);
});

test('getTTSProvider creates a new instance when altInstructions change', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, altInstructions: 'female, child' });
	assert.notEqual(a, b);
});

test('getTTSProvider creates a new instance when voiceId changes', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, voiceId: 'echo' });
	assert.notEqual(a, b);
});

test('getTTSProvider creates a new instance when altVoiceId changes', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, altVoiceId: 'nova' });
	assert.notEqual(a, b);
});

test('getTTSProvider creates a new instance when numStep changes', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, numStep: 16 });
	assert.notEqual(a, b);
});

test('getTTSProvider creates a new instance when altNumStep changes', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, altNumStep: 16 });
	assert.notEqual(a, b);
});

test('getTTSProvider returns the same instance when only language changes', () => {
	const a = getTTSProvider(baseOmniOptions);
	const b = getTTSProvider({ ...baseOmniOptions, language: 'es' });
	assert.equal(a, b);
});

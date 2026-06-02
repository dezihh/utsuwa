import test from 'node:test';
import assert from 'node:assert/strict';

import { inferResponseLengthMode } from './response-length.ts';

test('detects brief response requests', () => {
	assert.equal(inferResponseLengthMode('Bitte kurz antworten.'), 'brief');
	assert.equal(inferResponseLengthMode('Keep it concise.'), 'brief');
});

test('detects longform response requests', () => {
	assert.equal(inferResponseLengthMode('Erzähle mir eine Geschichte.'), 'longform');
	assert.equal(inferResponseLengthMode('Please give a detailed explanation.'), 'longform');
});

test('defaults to balanced responses', () => {
	assert.equal(inferResponseLengthMode('Wie geht es dir?'), 'balanced');
});

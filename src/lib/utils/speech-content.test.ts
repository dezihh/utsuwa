import { describe, test } from 'node:test';
import assert from 'node:assert';
import { getSpeakableText } from './speech-content.ts';

describe('getSpeakableText', () => {
	test('returns the original text when it contains letters and numbers', () => {
		assert.equal(getSpeakableText('Hello world 123'), 'Helloworld123');
	});

	test('strips whitespace', () => {
		assert.equal(getSpeakableText('  hello  '), 'hello');
	});

	test('strips punctuation', () => {
		assert.equal(getSpeakableText('Hello, world!'), 'Helloworld');
	});

	test('strips emoji', () => {
		assert.equal(getSpeakableText('Hello 😀 world'), 'Helloworld');
	});

	test('returns empty string for emoji-only input', () => {
		assert.equal(getSpeakableText('😀🎉'), '');
	});

	test('returns empty string for whitespace-only input', () => {
		assert.equal(getSpeakableText('   \t\n  '), '');
	});

	test('returns empty string for undefined and null', () => {
		assert.equal(getSpeakableText(undefined), '');
		assert.equal(getSpeakableText(null), '');
	});
});

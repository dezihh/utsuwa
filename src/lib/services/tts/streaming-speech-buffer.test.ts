import test from 'node:test';
import assert from 'node:assert/strict';

import { StreamingSpeechBuffer } from './streaming-speech-buffer.ts';

function createBuffer() {
	const segments: { text: string; language?: string }[] = [];
	const buffer = new StreamingSpeechBuffer({
		defaultLanguage: 'en',
		onSegment: (seg) => segments.push(seg)
	});
	return { buffer, segments };
}

test('emits a complete sentence immediately', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('Hello world.');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].text, 'Hello world.');
});

test('emits multiple sentences from one chunk', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('First sentence. Second sentence.');
	assert.equal(segments.length, 2);
	assert.equal(segments[0].text, 'First sentence.');
	assert.equal(segments[1].text, 'Second sentence.');
});

test('buffers partial sentences until a terminator arrives', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('Hello ');
	assert.equal(segments.length, 0);
	buffer.feed('world.');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].text, 'Hello world.');
});

test('flushes remaining text without a terminator', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('No terminator here');
	assert.equal(segments.length, 0);
	buffer.flush();
	assert.equal(segments.length, 1);
	assert.equal(segments[0].text, 'No terminator here');
});

test('splits at paragraph breaks', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('Paragraph one.\n\nParagraph two.');
	assert.equal(segments.length, 2);
	assert.equal(segments[0].text, 'Paragraph one.');
	assert.equal(segments[1].text, 'Paragraph two.');
});

test('does not emit while inside an open JSON block', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('Hello. {"mood_change":');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].text, 'Hello.');
	buffer.feed('{"emotion":"happy"}} Goodbye.');
	assert.equal(segments.length, 2);
	assert.equal(segments[1].text, 'Goodbye.');
});

test('reset clears pending text', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('Pending');
	buffer.reset();
	buffer.flush();
	assert.equal(segments.length, 0);
});

test('skips segments containing only punctuation and whitespace', () => {
	const { buffer, segments } = createBuffer();
	buffer.feed('   ');
	buffer.flush();
	assert.equal(segments.length, 0);
});

// OmniVoice-style language-marked tool calls -------------------------------

function createLanguageBuffer(defaultLanguage = 'de') {
	const segments: { text: string; language?: string }[] = [];
	const buffer = new StreamingSpeechBuffer({
		defaultLanguage,
		onSegment: (seg) => segments.push(seg)
	});
	return { buffer, segments };
}

test('emits a complete speak call immediately', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"Hallo","lang":"de"})');
	assert.deepEqual(segments, [{ text: 'Hallo', language: 'de' }]);
});

test('emits a speak call split across multiple chunks only when complete', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"Hall');
	assert.equal(segments.length, 0);
	buffer.feed('o","lang":"de"})');
	assert.deepEqual(segments, [{ text: 'Hallo', language: 'de' }]);
});

test('does not emit completed language calls twice when more chunks arrive', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"Hallo","lang":"de"})');
	assert.equal(segments.length, 1);
	buffer.feed(' speak({"text":"Welt","lang":"de"})');
	assert.equal(segments.length, 2);
	assert.deepEqual(segments, [
		{ text: 'Hallo', language: 'de' },
		{ text: 'Welt', language: 'de' }
	]);
});

test('flush does not emit completed language calls twice', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"hola","lang":"es"})');
	buffer.flush();
	assert.deepEqual(segments, [{ text: 'hola', language: 'es' }]);
});

test('preserves language switches within one sentence as separate segments', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"Auf Spanisch sagt man ","lang":"de"})');
	buffer.feed(' speak({"text":"por favor,","lang":"es"})');
	buffer.feed(' speak({"text":" bitte.","lang":"de"})');

	assert.deepEqual(segments, [
		{ text: 'Auf Spanisch sagt man', language: 'de' },
		{ text: 'por favor,', language: 'es' },
		{ text: 'bitte.', language: 'de' }
	]);
});

test('keeps explicit language codes unchanged', () => {
	const { buffer, segments } = createLanguageBuffer('en');
	buffer.feed('speak({"text":"Hola","lang":"es"})');
	buffer.feed(' speak({"text":"Hello","lang":"en"})');
	buffer.feed(' speak({"text":"Bonjour","lang":"fr"})');

	assert.deepEqual(segments, [
		{ text: 'Hola', language: 'es' },
		{ text: 'Hello', language: 'en' },
		{ text: 'Bonjour', language: 'fr' }
	]);
});

test('never speaks raw or incomplete speak syntax', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"Hallo"');
	assert.equal(segments.length, 0);

	buffer.feed(',"lang":"de"})');
	assert.deepEqual(segments, [{ text: 'Hallo', language: 'de' }]);
});

test('does not speak incomplete tool calls on explicit flush', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('speak({"text":"Hal');
	buffer.flush();
	assert.equal(segments.length, 0);
});

test('plaintext before a speak call is still emitted', () => {
	const { buffer, segments } = createLanguageBuffer();
	buffer.feed('Hello world. speak({"text":"Hola","lang":"es"})');
	assert.deepEqual(segments, [
		{ text: 'Hello world.', language: 'de' },
		{ text: 'Hola', language: 'es' }
	]);
});

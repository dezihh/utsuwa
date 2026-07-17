import test from 'node:test';
import assert from 'node:assert/strict';

import { splitIntoSentences, stripForSpeech, splitIntoSegments } from './sentences.ts';

// --- splitIntoSentences ---

test('splits text at sentence-ending punctuation', () => {
	const text = 'Hello world. How are you? I am fine.';
	const result = splitIntoSentences(text);
	assert.deepEqual(result, ['Hello world.', 'How are you?', 'I am fine.']);
});

test('returns the whole text as one sentence when no boundary exists', () => {
	const text = 'Just one long sentence without terminator';
	const result = splitIntoSentences(text);
	assert.deepEqual(result, [text]);
});

test('returns empty array for whitespace-only input', () => {
	assert.deepEqual(splitIntoSentences('   '), []);
	assert.deepEqual(splitIntoSentences(''), []);
});

// --- stripForSpeech ---

test('strips fenced JSON blocks', () => {
	const text = 'Hello. ```json\n{"mood_change":{}}\n``` Goodbye.';
	const { cleaned } = stripForSpeech(text);
	assert.equal(cleaned, 'Hello. Goodbye.');
});

test('strips inline JSON state-update blocks', () => {
	const text = 'Hello. {"mood_change":{"emotion":"happy"}} Goodbye.';
	const { cleaned } = stripForSpeech(text);
	assert.equal(cleaned, 'Hello. Goodbye.');
});

test('removes markdown asterisks and arrows', () => {
	const text = 'This is *bold* and → there.';
	const { cleaned } = stripForSpeech(text);
	assert.equal(cleaned, 'This is bold and there.');
});

// --- splitIntoSegments ---

test('creates segments with default language', () => {
	const text = 'First sentence. Second sentence.';
	const segments = splitIntoSegments(text, 'de');
	assert.equal(segments.length, 2);
	assert.equal(segments[0].text, 'First sentence.');
	assert.equal(segments[0].language, 'de');
	assert.equal(segments[1].text, 'Second sentence.');
	assert.equal(segments[1].language, 'de');
});

test('returns empty array for empty text', () => {
	assert.deepEqual(splitIntoSegments('', 'en'), []);
});

// --- splitIntoSegments language tags ---

test('splits <lang=xx> tags into segments with correct language', () => {
	const text = 'Hello. <lang=es>Hola mundo.</lang> Goodbye.';
	const segments = splitIntoSegments(text, 'en');
	assert.equal(segments.length, 3);
	assert.equal(segments[0].text, 'Hello.');
	assert.equal(segments[0].language, 'en');
	assert.equal(segments[1].text, 'Hola mundo.');
	assert.equal(segments[1].language, 'es');
	assert.equal(segments[2].text, 'Goodbye.');
	assert.equal(segments[2].language, 'en');
});

test('supports XML attribute syntax <lang code="xx">', () => {
	const text = '<lang code="fr">Bonjour.</lang>';
	const segments = splitIntoSegments(text, 'en');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].text, 'Bonjour.');
	assert.equal(segments[0].language, 'fr');
});

test('supports legacy bracket syntax [lang:xx]', () => {
	const text = '[lang:it]Ciao.[/lang]';
	const segments = splitIntoSegments(text, 'en');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].text, 'Ciao.');
	assert.equal(segments[0].language, 'it');
});

test('falls back to default language when no tag is present', () => {
	const text = 'Just a normal sentence.';
	const segments = splitIntoSegments(text, 'de');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].language, 'de');
});

test('returns empty array when text only contains language tags', () => {
	const text = '<lang=es></lang>';
	const segments = splitIntoSegments(text, 'en');
	assert.deepEqual(segments, []);
});

test('preserves language across multiple sentences inside a tag', () => {
	const text = '<lang=es>Hola. ¿Cómo estás?</lang>';
	const segments = splitIntoSegments(text, 'en');
	assert.equal(segments.length, 2);
	assert.equal(segments[0].language, 'es');
	assert.equal(segments[1].language, 'es');
});

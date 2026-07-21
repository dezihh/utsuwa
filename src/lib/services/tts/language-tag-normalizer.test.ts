import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLanguageTags } from './language-tag-normalizer.ts';

test('converts bracket lang tags to speak calls', () => {
	const { calls, cleanedText } = normalizeLanguageTags(
		'Hallo [lang:es]¡Hola![/lang] Wie geht es dir?',
		'de'
	);
	assert.equal(calls.length, 3);
	assert.equal(calls[0].name, 'speak');
	assert.equal(calls[0].arguments.text, 'Hallo');
	assert.equal(calls[0].arguments.lang, 'de');
	assert.equal(calls[1].name, 'speak');
	assert.equal(calls[1].arguments.text, '¡Hola!');
	assert.equal(calls[1].arguments.lang, 'es');
	assert.equal(cleanedText, 'Hallo ¡Hola! Wie geht es dir?');
});

test('converts angle-colon speak tags to speak calls', () => {
	const { calls, cleanedText } = normalizeLanguageTags(
		'Hello <speak:es>¿Cómo estás?</speak> Goodbye',
		'en'
	);
	assert.equal(calls.length, 3);
	assert.equal(calls[1].arguments.lang, 'es');
	assert.equal(calls[1].arguments.text, '¿Cómo estás?');
	assert.equal(cleanedText, 'Hello ¿Cómo estás? Goodbye');
});

test('converts angle-equals lang tags to speak calls', () => {
	const { calls, cleanedText } = normalizeLanguageTags(
		'Salut <lang=fr>Comment ça va?</lang> Au revoir',
		'fr'
	);
	assert.equal(calls.length, 3);
	assert.equal(calls[1].arguments.lang, 'fr');
	assert.equal(cleanedText, 'Salut Comment ça va? Au revoir');
});

test('converts gesture tags to gesture calls', () => {
	const { calls, cleanedText } = normalizeLanguageTags(
		'Hello <gesture:smile> how are you?',
		'en'
	);
	assert.equal(calls.length, 3);
	assert.equal(calls[0].name, 'speak');
	assert.equal(calls[0].arguments.text, 'Hello');
	assert.equal(calls[1].name, 'gesture');
	assert.equal(calls[1].arguments.type, 'smile');
	assert.equal(calls[2].name, 'speak');
	assert.equal(cleanedText, 'Hello how are you?');
});

test('handles mixed formats in one message', () => {
	const { calls, cleanedText } = normalizeLanguageTags(
		'Hallo [lang:es]¡Hola![/lang] <gesture:smile> <speak:es>¿Qué tal?</speak> Bis bald',
		'de'
	);
	assert.equal(calls.filter((c) => c.name === 'speak').length, 4);
	assert.equal(calls.filter((c) => c.name === 'gesture').length, 1);
	assert.equal(cleanedText, 'Hallo ¡Hola! ¿Qué tal? Bis bald');
});

test('returns original text as single speak call when no markers found', () => {
	const { calls, cleanedText } = normalizeLanguageTags('Hello world', 'en');
	assert.equal(calls.length, 1);
	assert.equal(calls[0].arguments.text, 'Hello world');
	assert.equal(cleanedText, 'Hello world');
});

test('ignores empty marker text', () => {
	const { calls, cleanedText } = normalizeLanguageTags('Hallo [lang:es][/lang] Welt', 'de');
	assert.equal(calls.length, 2);
	assert.equal(cleanedText, 'Hallo Welt');
});

test('handles bracket gesture tags', () => {
	const { calls } = normalizeLanguageTags('Hi [gesture:wave] there', 'en');
	assert.equal(calls[0].name, 'speak');
	assert.equal(calls[1].name, 'gesture');
	assert.equal(calls[1].arguments.type, 'wave');
	assert.equal(calls[2].name, 'speak');
});

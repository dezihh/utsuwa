import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeechMarkers, reconstructChatText } from './chat-text.ts';

test('reconstructs from three speak calls', () => {
	const result = reconstructChatText([
		{ name: 'speak', arguments: { text: 'Hello', lang: 'en' } },
		{ name: 'speak', arguments: { text: 'world', lang: 'en' } },
		{ name: 'speak', arguments: { text: 'today', lang: 'en' } }
	]);
	assert.equal(result, 'Hello world today');
});

test('ignores pause and gesture calls', () => {
	const result = reconstructChatText([
		{ name: 'speak', arguments: { text: 'Hi' } },
		{ name: 'pause', arguments: { ms: 500 } },
		{ name: 'gesture', arguments: { type: 'smile' } },
		{ name: 'speak', arguments: { text: 'there' } }
	]);
	assert.equal(result, 'Hi there');
});

test('returns empty string for empty input', () => {
	assert.equal(reconstructChatText([]), '');
});

test('returns empty string when no speak calls present', () => {
	assert.equal(
		reconstructChatText([
			{ name: 'pause', arguments: { ms: 200 } },
			{ name: 'gesture', arguments: { type: 'wave' } }
		]),
		''
	);
});

test('handles speak calls with missing text', () => {
	const result = reconstructChatText([
		{ name: 'speak', arguments: { lang: 'en' } },
		{ name: 'speak', arguments: { text: 'Hello' } }
	]);
	assert.equal(result, ' Hello');
});

// ── cleanSpeechMarkers ─────────────────────────────────────

test('cleanSpeechMarkers removes angle speak tags keeping inner text', () => {
	const result = cleanSpeechMarkers('Hola <speak:es>¿Cómo estás?</speak> bien', 'en');
	assert.equal(result, 'Hola ¿Cómo estás? bien');
});

test('cleanSpeechMarkers removes bracket lang tags keeping inner text', () => {
	const result = cleanSpeechMarkers('Hallo [lang:es]¡Hola![/lang] Welt', 'de');
	assert.equal(result, 'Hallo ¡Hola! Welt');
});

test('cleanSpeechMarkers removes lang equals tags and gesture markers', () => {
	const result = cleanSpeechMarkers('Hi <lang=fr>Salut</lang> <gesture:wave> there', 'en');
	assert.equal(result, 'Hi Salut there');
});

test('cleanSpeechMarkers removes angle-code lang tags keeping inner text', () => {
	const result = cleanSpeechMarkers(
		'Das spanische Wort für Hahn ist <lang code="es">gallo</lang>.',
		'de'
	);
	assert.equal(result, 'Das spanische Wort für Hahn ist gallo .');
});

test('cleanSpeechMarkers returns plain text unchanged when no markers', () => {
	const result = cleanSpeechMarkers('Hello world', 'en');
	assert.equal(result, 'Hello world');
});

test('cleanSpeechMarkers removes pseudo-tool-call syntax', () => {
	const result = cleanSpeechMarkers(
		'Hola speak({ lang: "es", text: "¿Cómo estás?" }) amigo',
		'en'
	);
	assert.equal(result, 'Hola ¿Cómo estás? amigo');
});

test('cleanSpeechMarkers removes gesture pseudo-tool-call', () => {
	const result = cleanSpeechMarkers(
		'Hello gesture({ type: "smile" }) there',
		'en'
	);
	assert.equal(result, 'Hello there');
});
test('cleanSpeechMarkers strips inline tags even when no pseudo-tool-calls exist', () => {
	const result = cleanSpeechMarkers('Hola [lang:es]mundo[/lang]', 'en');
	assert.equal(result, 'Hola mundo');
});

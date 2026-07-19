import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructChatText } from './chat-text.ts';

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
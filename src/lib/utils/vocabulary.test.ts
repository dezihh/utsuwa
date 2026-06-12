import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVocabTags, parseVocabTag } from './vocabulary.ts';

test('parseVocabTag parses category tag', () => {
	const result = parseVocabTag('[vocab:category:Begrüßung:10]');
	assert.deepEqual(result, { mode: 'category', filter: 'Begrüßung', count: 10 });
});

test('parseVocabTag parses review tag', () => {
	const result = parseVocabTag('[vocab:review:5]');
	assert.deepEqual(result, { mode: 'review', filter: undefined, count: 5 });
});

test('parseVocabTag parses level tag', () => {
	const result = parseVocabTag('[vocab:level:A1:20]');
	assert.deepEqual(result, { mode: 'level', filter: 'A1', count: 20 });
});

test('parseVocabTag rejects invalid tag', () => {
	assert.equal(parseVocabTag('[invalid]'), null);
	assert.equal(parseVocabTag('[vocab:unknown:5]'), null);
});

test('extractVocabTags extracts tags and cleans text', () => {
	const { tags, cleanedText } = extractVocabTags('Hello [vocab:category:Begrüßung:5] world');
	assert.equal(tags.length, 1);
	assert.deepEqual(tags[0], { mode: 'category', filter: 'Begrüßung', count: 5 });
	assert.equal(cleanedText.trim(), 'Hello  world');
});

test('extractVocabTags handles multiple tags', () => {
	const { tags, cleanedText } = extractVocabTags(
		'[vocab:review:3] and [vocab:level:A2:10]'
	);
	assert.equal(tags.length, 2);
	assert.equal(cleanedText.trim(), 'and');
});

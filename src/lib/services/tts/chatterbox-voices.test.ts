import test from 'node:test';
import assert from 'node:assert/strict';

import { mapChatterboxVoice, voiceToServerPath, getTestPhrase, CHATTERBOX_LANGUAGES, CHATTERBOX_TEST_PHRASES } from './chatterbox-voices.ts';

test('mapChatterboxVoice keeps generated voices unchanged', () => {
	assert.deepEqual(mapChatterboxVoice({ id: 'Abigail', filename: 'Abigail.wav' }), {
		id: 'Abigail',
		name: 'Abigail'
	});
});

test('mapChatterboxVoice prefixes upstream reference voices with ref:', () => {
	assert.deepEqual(
		mapChatterboxVoice({ id: 'myclone', filename: 'myclone.wav', is_reference: true }),
		{
			id: 'ref:myclone',
			name: 'myclone'
		}
	);
});

test('mapChatterboxVoice does not double-prefix server-prefixed reference voices', () => {
	assert.deepEqual(
		mapChatterboxVoice({
			id: 'ref:myclone',
			filename: 'myclone.wav',
			is_reference: true
		}),
		{
			id: 'ref:myclone',
			name: 'myclone'
		}
	);
});

test('voiceToServerPath routes generated voices to voices/', () => {
	assert.equal(voiceToServerPath('Abigail'), 'voices/Abigail.wav');
});

test('voiceToServerPath routes reference voices to reference_audio/', () => {
	assert.equal(voiceToServerPath('ref:myclone'), 'reference_audio/myclone.wav');
});

test('getTestPhrase falls back to English for undefined or unknown languages', () => {
	assert.equal(getTestPhrase(undefined), CHATTERBOX_TEST_PHRASES['en']);
	assert.equal(getTestPhrase('xx'), CHATTERBOX_TEST_PHRASES['en']);
});

test('getTestPhrase returns a localized phrase for supported languages', () => {
	assert.equal(getTestPhrase('de'), CHATTERBOX_TEST_PHRASES['de']);
	assert.ok(getTestPhrase('ja').length > 0);
});

test('every supported language except auto has a test phrase', () => {
	const autoEntry = CHATTERBOX_LANGUAGES.find((l) => l.code === '');
	assert.ok(autoEntry);
	for (const lang of CHATTERBOX_LANGUAGES) {
		if (lang.code === '') continue;
		assert.ok(
			lang.code in CHATTERBOX_TEST_PHRASES,
			`missing test phrase for ${lang.code}`
		);
	}
});

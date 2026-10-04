import test from 'node:test';
import assert from 'node:assert/strict';

import { extractHostname, toDataUrl } from './image-search.ts';

test('extractHostname returns the host or a safe fallback', () => {
	assert.equal(extractHostname('https://example.com/a/b.png'), 'example.com');
	assert.equal(extractHostname('not a url'), 'unknown');
});

test('toDataUrl builds a data URL and defaults an empty MIME type', () => {
	assert.equal(toDataUrl('image/png', 'AAAA'), 'data:image/png;base64,AAAA');
	assert.equal(toDataUrl('', 'AAAA'), 'data:application/octet-stream;base64,AAAA');
});

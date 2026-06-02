import test from 'node:test';
import assert from 'node:assert/strict';

import { StreamingSpeechBuffer } from './streaming-speech-buffer.ts';

test('emits sentence-sized segments during streaming', () => {
	const segments: string[] = [];
	const buffer = new StreamingSpeechBuffer({
		streaming: true,
		onSegment: (segment) => segments.push(segment.text)
	});

	buffer.feed('Hello world. This is a test. More');

	assert.deepEqual(segments, ['Hello world.', 'This is a test.']);

	buffer.feed(' follows.');
	buffer.flush();

	assert.deepEqual(segments, ['Hello world.', 'This is a test.', 'More follows.']);
});

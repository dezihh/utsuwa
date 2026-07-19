import test from 'node:test';
import assert from 'node:assert/strict';

// Mock setTimeout/clearTimeout — execute callbacks immediately for synchronous tests
globalThis.setTimeout = ((fn: () => void, _ms: number) => {
	fn();
	return 1;
}) as typeof setTimeout;
globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
(globalThis as Record<string, unknown>).window = globalThis;

import { SpeechScheduler } from './speech-scheduler.ts';
import type { CompiledSegment } from './speech-compiler.ts';
import type { TTSOptions } from './index.ts';
import type { SpeechSegment } from '../voice-orchestrator.ts';

const baseOptions: TTSOptions = { provider: 'omnivoice', voiceId: 'alloy' };

function makeMockOrchestrator() {
	let capturedSegments: SpeechSegment[] = [];
	let intercepted = false;
	let completed = false;

	function speakSegments(
		segments: SpeechSegment[],
		_options: TTSOptions,
		callbacks?: { onSegmentStart?: (s: SpeechSegment) => void; onComplete?: () => void }
	) {
		capturedSegments = segments;
		if (callbacks?.onSegmentStart) {
			for (const seg of segments) {
				callbacks.onSegmentStart(seg);
			}
		}
		completed = true;
		callbacks?.onComplete?.();
		return Promise.resolve();
	}

	return {
		speakSegments,
		interrupt: () => { intercepted = true; },
		getSegments: () => capturedSegments,
		wasIntercepted: () => intercepted,
		wasCompleted: () => completed
	};
}

test('beginPlan translates speak segments to orchestrator', async () => {
	const mock = makeMockOrchestrator();
	const s = new SpeechScheduler(mock as any);
	const segments: CompiledSegment[] = [
		{ type: 'speak', text: 'Hello', language: 'en' },
		{ type: 'speak', text: 'world', language: 'en' }
	];
	await s.beginPlan(segments, baseOptions);

	const captured = mock.getSegments();
	assert.equal(captured.length, 2);
	assert.equal(captured[0].text, 'Hello');
	assert.equal(captured[0].language, 'en');
	assert.ok(mock.wasCompleted());
});

test('beginPlan skips gesture and pause segments from orchestrator calls', async () => {
	const mock = makeMockOrchestrator();
	const s = new SpeechScheduler(mock as any);
	const segments: CompiledSegment[] = [
		{ type: 'gesture', gestureType: 'smile', language: '' },
		{ type: 'speak', text: 'Hello', language: 'en' },
		{ type: 'pause', durationMs: 200, language: '' },
		{ type: 'speak', text: 'world', language: 'en' }
	];
	await s.beginPlan(segments, baseOptions);

	// Only speak segments should reach the orchestrator
	const captured = mock.getSegments();
	assert.equal(captured.length, 2);
	assert.equal(captured[0].text, 'Hello');
	assert.equal(captured[1].text, 'world');
});

test('interrupt calls orchestrator.interrupt', () => {
	const mock = makeMockOrchestrator();
	const s = new SpeechScheduler(mock as any);
	s.interrupt();
	assert.ok(mock.wasIntercepted());
});

test('getStores returns gesture and subtitle stores', () => {
	const mock = makeMockOrchestrator();
	const s = new SpeechScheduler(mock as any);
	const stores = s.getStores();
	assert.ok('gesture' in stores);
	assert.ok('subtitle' in stores);
	assert.equal(stores.gesture.active, false);
});
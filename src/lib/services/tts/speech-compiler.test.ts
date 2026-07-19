import test from 'node:test';
import assert from 'node:assert/strict';
import {
	validateCalls,
	splitLongSegments,
	mergeSegments,
	resolveLanguage,
	compileSegments,
	compile,
	compileFromText,
	recover,
	type ToolCall
} from './speech-compiler.ts';

// ── validateCalls ──────────────────────────────────────────

test('validateCalls passes through valid speak calls', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello', lang: 'en' } },
		{ name: 'speak', arguments: { text: 'World' } }
	];
	const result = validateCalls(input, 'de');
	assert.equal(result.length, 2);
	assert.equal(result[0].arguments.text, 'Hello');
	assert.equal(result[0].arguments.lang, 'en');
	assert.equal(result[1].arguments.lang, 'de'); // filled from primaryLanguage
});

test('validateCalls clamps pause ms', () => {
	const result = validateCalls([{ name: 'pause', arguments: { ms: 50 } }], 'de');
	assert.equal(result[0].arguments.ms, 100);
	const result2 = validateCalls([{ name: 'pause', arguments: { ms: 10000 } }], 'de');
	assert.equal(result2[0].arguments.ms, 5000);
});

test('validateCalls discards unknown gesture types', () => {
	const result = validateCalls([{ name: 'gesture', arguments: { type: 'cry' } }], 'de');
	assert.equal(result.length, 0);
});

test('validateCalls passes valid gesture types', () => {
	const result = validateCalls([{ name: 'gesture', arguments: { type: 'smile' } }], 'de');
	assert.equal(result.length, 1);
	assert.equal(result[0].arguments.type, 'smile');
});

test('validateCalls discards unknown tool names', () => {
	const result = validateCalls([{ name: 'dance', arguments: {} }], 'de');
	assert.equal(result.length, 0);
});

test('validateCalls handles empty text in speak', () => {
	const result = validateCalls([{ name: 'speak', arguments: { text: '', lang: 'fr' } }], 'de');
	assert.equal(result[0].arguments.text, '');
});

// ── splitLongSegments ─────────────────────────────────────

test('splitLongSegments splits a speak with 4 sentences', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello! How are you? I am fine. Thanks for asking.', lang: 'en' } }
	];
	const result = splitLongSegments(input);
	assert.equal(result.length, 4);
	assert.equal(result[0].arguments.text, 'Hello!');
	assert.equal(result[0].arguments.lang, 'en');
});

test('splitLongSegments leaves a single sentence untouched', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello.', lang: 'en' } }
	];
	const result = splitLongSegments(input);
	assert.equal(result.length, 1);
});

test('splitLongSegments leaves two sentences untouched (compiler threshold)', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello. How are you?', lang: 'en' } }
	];
	const result = splitLongSegments(input);
	assert.equal(result.length, 1);
});

test('splitLongSegments preserves non-speak calls', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'A. B. C. D.', lang: 'en' } },
		{ name: 'pause', arguments: { ms: 200 } }
	];
	const result = splitLongSegments(input);
	assert.ok(result.length >= 4);
	assert.equal(result[result.length - 1].name, 'pause');
});

// ── mergeSegments ─────────────────────────────────────────

test('mergeSegments merges consecutive same-language calls', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello', lang: 'en' } },
		{ name: 'speak', arguments: { text: 'world', lang: 'en' } }
	];
	const result = mergeSegments(input);
	assert.equal(result.length, 1);
	assert.equal(result[0].arguments.text, 'Hello world');
});

test('mergeSegments does not merge across language boundaries', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hallo', lang: 'de' } },
		{ name: 'speak', arguments: { text: 'Hola', lang: 'es' } },
		{ name: 'speak', arguments: { text: 'Welt', lang: 'de' } }
	];
	const result = mergeSegments(input);
	assert.equal(result.length, 3);
});

test('mergeSegments does not merge when combined exceeds 15 words', () => {
	const first = Array.from({ length: 10 }, (_, i) => `word${i}`).join(' ');
	const second = Array.from({ length: 10 }, (_, i) => `extra${i}`).join(' ');
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: first, lang: 'en' } },
		{ name: 'speak', arguments: { text: second, lang: 'en' } }
	];
	const result = mergeSegments(input);
	assert.equal(result.length, 2); // 20 words total — too many
});

test('mergeSegments does not merge pause or gesture between speaks', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hi', lang: 'en' } },
		{ name: 'pause', arguments: { ms: 200 } },
		{ name: 'speak', arguments: { text: 'there', lang: 'en' } }
	];
	const result = mergeSegments(input);
	assert.equal(result.length, 3);
});

// ── resolveLanguage ───────────────────────────────────────

test('resolveLanguage fills undefined lang with primaryLanguage', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello' } }
	];
	const result = resolveLanguage(input, 'de');
	assert.equal(result[0].arguments.lang, 'de');
});

test('resolveLanguage preserves explicit lang', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hola', lang: 'es' } }
	];
	const result = resolveLanguage(input, 'de');
	assert.equal(result[0].arguments.lang, 'es');
});

// ── compileSegments ───────────────────────────────────────

test('compileSegments maps speak to CompiledSegment', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello', lang: 'en' } }
	];
	const result = compileSegments(input);
	assert.equal(result.length, 1);
	assert.equal(result[0].type, 'speak');
	assert.equal(result[0].text, 'Hello');
	assert.equal(result[0].language, 'en');
});

test('compileSegments maps pause to CompiledSegment', () => {
	const result = compileSegments([{ name: 'pause', arguments: { ms: 500 } }]);
	assert.equal(result[0].type, 'pause');
	assert.equal(result[0].durationMs, 500);
});

test('compileSegments maps gesture to CompiledSegment', () => {
	const result = compileSegments([{ name: 'gesture', arguments: { type: 'wave' } }]);
	assert.equal(result[0].type, 'gesture');
	assert.equal(result[0].gestureType, 'wave');
	assert.equal(result[0].durationMs, 1500);
});

// ── compile (full pipeline) ────────────────────────────────

test('compile runs the full pipeline', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hello', lang: 'en' } },
		{ name: 'pause', arguments: { ms: 200 } },
		{ name: 'speak', arguments: { text: 'World', lang: 'en' } }
	];
	const result = compile(input, 'de');
	// pause between speaks prevents merge → 3 segments
	assert.equal(result.segments.length, 3);
	assert.equal(result.segments[0].type, 'speak');
	assert.equal(result.segments[0].text, 'Hello');
	assert.equal(result.segments[1].type, 'pause');
	assert.equal(result.segments[2].type, 'speak');
	assert.equal(result.segments[2].text, 'World');
	assert.equal(result.errors.length, 0);
});

test('compile handles empty input', () => {
	const result = compile([], 'de');
	assert.equal(result.segments.length, 0);
	assert.ok(result.errors.length > 0);
});

// ── compileFromText (fallback) ─────────────────────────────

test('compileFromText creates single speak segment from plain text', () => {
	const result = compileFromText('Hello world.', 'en');
	assert.equal(result.segments.length, 1);
	assert.equal(result.segments[0].type, 'speak');
	assert.equal(result.segments[0].text, 'Hello world.');
	assert.equal(result.segments[0].language, 'en');
	assert.equal(result.errors.length, 0);
});

test('compileFromText handles empty text', () => {
	const result = compileFromText('', 'de');
	assert.equal(result.segments.length, 0);
	assert.ok(result.errors.length > 0);
});

// ── Regression tests ──────────────────────────────────────

test('recover creates a single speak segment from raw text', () => {
	const segments = recover('Hello world. How are you?', 'en');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].type, 'speak');
	assert.equal(segments[0].text, 'Hello world. How are you?');
	assert.equal(segments[0].language, 'en');
});

test('recover returns empty for empty input', () => {
	assert.equal(recover('', 'de').length, 0);
	assert.equal(recover('   ', 'de').length, 0);
});

test('regression: Spanish teacher scenario — separate language segments kept separate', () => {
	const input: ToolCall[] = [
		{ name: 'speak', arguments: { text: 'Hallo heißt auf spanisch', lang: 'de' } },
		{ name: 'speak', arguments: { text: 'Hola', lang: 'es' } },
		{ name: 'speak', arguments: { text: 'Das bedeutet Begrüßung.', lang: 'de' } }
	];
	const result = compile(input, 'de');
	assert.equal(result.segments.length, 3);
	assert.equal(result.segments[0].language, 'de');
	assert.equal(result.segments[1].language, 'es');
	assert.equal(result.segments[2].language, 'de');
});
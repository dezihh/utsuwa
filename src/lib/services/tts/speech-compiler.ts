export interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface CompiledSegment {
	type: 'speak' | 'pause' | 'gesture';
	text?: string;
	language: string;
	durationMs?: number;
	gestureType?: string;
}

export interface CompilerResult {
	segments: CompiledSegment[];
	errors: string[];
}

/**
 * Validate raw tool calls from the LLM. Fills missing fields,
 * clamps values, and discards unrecognized calls.
 */
export function validateCalls(calls: ToolCall[], primaryLanguage: string): ToolCall[] {
	const knownTools = new Set(['speak', 'pause', 'gesture']);
	const result: ToolCall[] = [];
	for (const c of calls) {
		if (!knownTools.has(c.name)) continue;

		if (c.name === 'speak') {
			const text = typeof c.arguments.text === 'string' ? c.arguments.text : '';
			const lang = typeof c.arguments.lang === 'string' &&
				c.arguments.lang.length >= 2 && c.arguments.lang.length <= 5
				? c.arguments.lang
				: primaryLanguage;
			result.push({ name: 'speak', arguments: { text, lang } });
		} else if (c.name === 'pause') {
			const ms = typeof c.arguments.ms === 'number' ? Math.round(c.arguments.ms) : 500;
			result.push({ name: 'pause', arguments: { ms: Math.max(100, Math.min(5000, ms)) } });
		} else if (c.name === 'gesture') {
			const valid = new Set(['smile', 'laugh', 'surprise', 'nod', 'shake_head', 'wave']);
			const type = String(c.arguments.type ?? '');
			if (valid.has(type)) {
				result.push({ name: 'gesture', arguments: { type } });
			}
		}
	}
	return result;
}

/**
 * Split long speak() calls at sentence boundaries.
 * Ensures early TTS start even with uncooperative LLMs.
 */
export function splitLongSegments(calls: ToolCall[]): ToolCall[] {
	const result: ToolCall[] = [];
	const SENTENCE_RE = /[^.!?…\n]+[.!?…]+[\s'")\]]*/g;

	for (const call of calls) {
		if (call.name !== 'speak') {
			result.push(call);
			continue;
		}
		const text = String(call.arguments.text ?? '');
		const lang = String(call.arguments.lang ?? '');
		const matches = text.match(SENTENCE_RE);
		if (!matches || matches.length <= 2) {
			result.push(call);
			continue;
		}
		for (const sentence of matches) {
			const trimmed = sentence.trim();
			if (trimmed.length > 0) {
				result.push({ name: 'speak', arguments: { text: trimmed, lang } });
			}
		}
	}
	return result;
}

function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Merge consecutive speak() calls with the same language,
 * as long as total word count stays under ~15 words.
 */
export function mergeSegments(calls: ToolCall[]): ToolCall[] {
	const result: ToolCall[] = [];

	for (const call of calls) {
		if (call.name !== 'speak') {
			result.push(call);
			continue;
		}
		const prev = result.length > 0 ? result[result.length - 1] : null;
		if (prev && prev.name === 'speak' && prev.arguments.lang === call.arguments.lang) {
			const combined = String(prev.arguments.text) + ' ' + String(call.arguments.text);
			if (wordCount(combined) <= 15) {
				prev.arguments.text = combined.trim();
				continue;
			}
		}
		result.push({ ...call, arguments: { ...call.arguments } });
	}
	return result;
}

/**
 * Resolve undefined lang to primaryLanguage on every speak() call.
 */
export function resolveLanguage(calls: ToolCall[], primaryLanguage: string): ToolCall[] {
	return calls.map((c) => {
		if (c.name === 'speak' && !c.arguments.lang) {
			return { ...c, arguments: { ...c.arguments, lang: primaryLanguage } };
		}
		return c;
	});
}

/**
 * Convert validated and merged tool calls into CompiledSegments.
 */
export function compileSegments(calls: ToolCall[]): CompiledSegment[] {
	return calls.map((c) => {
		if (c.name === 'pause') {
			return {
				type: 'pause',
				language: '',
				durationMs: c.arguments.ms as number
			};
		}
		if (c.name === 'gesture') {
			return {
				type: 'gesture',
				language: '',
				gestureType: c.arguments.type as string,
				durationMs: 1500
			};
		}
		return {
			type: 'speak',
			text: c.arguments.text as string,
			language: c.arguments.lang as string
		};
	});
}

/**
 * Full compiler pipeline: validate → split → merge → resolve → compile.
 * Returns compiled segments and any errors.
 */
export function compile(calls: ToolCall[], primaryLanguage: string): CompilerResult {
	const errors: string[] = [];

	const validated = validateCalls(calls, primaryLanguage);
	const split = splitLongSegments(validated);
	const merged = mergeSegments(split);
	const resolved = resolveLanguage(merged, primaryLanguage);
	const segments = compileSegments(resolved);

	if (!calls || calls.length === 0) {
		errors.push('No tool calls provided');
	}

	return { segments, errors };
}

/**
 * Error recovery: given the original LLM output text and possibly invalid
 * tool calls, produce a single speak() segment as a graceful fallback.
 * Never throws — always returns at least one speak segment.
 */
export function recover(originalText: string, primaryLanguage: string): CompiledSegment[] {
	if (!originalText || !originalText.trim()) {
		return [];
	}
	return [{ type: 'speak', text: originalText.trim(), language: primaryLanguage }];
}

/**
 * Fallback: treat the entire raw LLM text as a single speak() call in primaryLanguage.
 */
export function compileFromText(text: string, primaryLanguage: string): CompilerResult {
	if (!text || !text.trim()) {
		return { segments: [], errors: ['Empty input'] };
	}
	return {
		segments: [{ type: 'speak', text: text.trim(), language: primaryLanguage }],
		errors: []
	};
}
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
			const lang =
				typeof c.arguments.lang === 'string' &&
				c.arguments.lang.length >= 2 &&
				c.arguments.lang.length <= 5
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

const SENTENCE_TERMINATOR_RE = /[.!?…]+[\s'")\]]*/g;

/**
 * Split long speak() calls at sentence boundaries.
 * Ensures early TTS start even with uncooperative LLMs.
 *
 * A speak with more than 2 sentences is broken into individual sentences.
 * Any trailing fragment without a terminator is preserved as its own segment
 * so no text is silently dropped.
 */
export function splitLongSegments(calls: ToolCall[]): ToolCall[] {
	const result: ToolCall[] = [];

	for (const call of calls) {
		if (call.name !== 'speak') {
			result.push(call);
			continue;
		}
		const text = String(call.arguments.text ?? '');
		const lang = String(call.arguments.lang ?? '');
		const terminators = Array.from(text.matchAll(SENTENCE_TERMINATOR_RE));

		if (terminators.length <= 2) {
			result.push(call);
			continue;
		}

		let lastIndex = 0;
		for (const match of terminators) {
			const endIndex = (match.index ?? 0) + match[0].length;
			const sentence = text.slice(lastIndex, endIndex).trim();
			if (sentence.length > 0) {
				result.push({ name: 'speak', arguments: { text: sentence, lang } });
			}
			lastIndex = endIndex;
		}

		// Preserve any trailing text that did not end with a terminator.
		const trailing = text.slice(lastIndex).trim();
		if (trailing.length > 0) {
			result.push({ name: 'speak', arguments: { text: trailing, lang } });
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
 *
 * The function never mutates the input calls; it only mutates copies it owns.
 */
export function mergeSegments(calls: ToolCall[]): ToolCall[] {
	const result: ToolCall[] = [];

	for (const call of calls) {
		if (call.name !== 'speak') {
			result.push({ ...call, arguments: { ...call.arguments } });
			continue;
		}

		const prev = result.length > 0 ? result[result.length - 1] : null;
		if (prev && prev.name === 'speak' && prev.arguments.lang === call.arguments.lang) {
			const combined = String(prev.arguments.text) + ' ' + String(call.arguments.text);
			if (wordCount(combined) <= 15) {
				prev.arguments = { ...prev.arguments, text: combined.trim() };
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
 *
 * If no calls are provided, returns an empty segment list without errors. The
 * caller can fall back to compileFromText() if needed.
 */
export function compile(calls: ToolCall[], primaryLanguage: string): CompilerResult {
	if (!calls || calls.length === 0) {
		return { segments: [], errors: [] };
	}

	const validated = validateCalls(calls, primaryLanguage);
	const split = splitLongSegments(validated);
	const merged = mergeSegments(split);
	const resolved = resolveLanguage(merged, primaryLanguage);
	const segments = compileSegments(resolved);

	return { segments, errors: [] };
}

/**
 * Error recovery: given the original LLM output text and possibly invalid
 * tool calls, produce a single speak() segment as a graceful fallback.
 * Never throws — always returns at least one speak segment.
 */
export function recover(originalText: string, primaryLanguage: string): CompiledSegment[] {
	return [{ type: 'speak', text: originalText.trim(), language: primaryLanguage }];
}

/**
 * Fallback: treat the entire raw LLM text as a single speak() call in primaryLanguage.
 */
export function compileFromText(text: string, primaryLanguage: string): CompilerResult {
	if (!text || !text.trim()) {
		return { segments: [], errors: [] };
	}
	return {
		segments: [{ type: 'speak', text: text.trim(), language: primaryLanguage }],
		errors: []
	};
}

export interface ParsedChunk {
	type: 'prose' | 'call';
	text?: string;
	call?: ToolCall;
}

export interface ParsedCalls {
	calls: ToolCall[];
	cleanedText: string;
	/** Ordered list of prose fragments and calls as they appeared in the text. */
	chunks: ParsedChunk[];
}

/**
 * Repair JavaScript-style object literals (unquoted keys, single quotes) so
 * they can be parsed as JSON. Models often emit `{ lang: "es", text: "..." }`
 * instead of strict JSON.
 */
function parseJsonArgs(raw: string): Record<string, unknown> {
	try {
		return JSON.parse(raw);
	} catch {
		// Quote unquoted object keys: { key: ... } -> { "key": ... }
		// Also normalise single-quoted string literals to double-quoted JSON.
		const repaired = raw
			.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
			.replace(/'([^']*)'/g, '"$1"');
		try {
			return JSON.parse(repaired);
		} catch {
			return {};
		}
	}
}

/**
 * Find the index of the closing brace that matches the first opening brace
 * after `start`, respecting strings and nested braces.
 */
function findClosingBrace(text: string, start: number): number | null {
	let depth = 0;
	let inStr = false;
	let strChar = '';
	let esc = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inStr) {
			if (esc) {
				esc = false;
			} else if (ch === '\\') {
				esc = true;
			} else if (ch === strChar) {
				inStr = false;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			inStr = true;
			strChar = ch;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return null;
}

/**
 * Parse pseudo-tool-calls from raw LLM text output.
 *
 * This is a fallback for models that do not support native tool calling (R1).
 * The LLM is instructed to emit `speak({...})`, `pause({...})`,
 * `gesture({...})` as part of its text response. This function extracts those
 * calls and returns the cleaned display text.
 *
 * Handles quoted strings containing `}` and JavaScript-style object literals
 * with unquoted keys.
 *
 * Returns parsed ToolCalls and the cleaned text with calls removed.
 * If no calls are found, returns an empty calls array and the original text.
 */
export function parsePseudoToolCalls(text: string): ParsedCalls {
	const calls: ToolCall[] = [];
	const chunks: ParsedChunk[] = [];
	const parts: string[] = [];
	let lastIndex = 0;

	const callStartRe = /(speak|pause|gesture)\(/g;
	let match: RegExpExecArray | null;
	while ((match = callStartRe.exec(text)) !== null) {
		const name = match[1];
		const argsStart = match.index + match[0].length;

		// Only accept object-literal arguments; skip things like speak("text").
		const firstNonWs = text.slice(argsStart).match(/\S/);
		if (!firstNonWs || firstNonWs[0] !== '{') continue;

		const argsEnd = findClosingBrace(text, argsStart);
		if (argsEnd === null) continue;

		const before = text.slice(lastIndex, match.index).trim();
		if (before) {
			parts.push(before);
			chunks.push({ type: 'prose', text: before });
		}

		const argsStr = text.slice(argsStart, argsEnd + 1);
		const args = parseJsonArgs(argsStr);
		const call: ToolCall = { name, arguments: args };

		// Inline speak text into the cleaned display text so foreign-language
		// segments still appear in the chat bubble. Drop pause/gesture markers.
		if (name === 'speak' && typeof args.text === 'string') {
			parts.push(args.text);
		}

		calls.push(call);
		chunks.push({ type: 'call', call });
		lastIndex = argsEnd + 1;

		// Swallow the closing parenthesis of the function call, if present.
		const closingParen = text.slice(lastIndex).match(/^\s*\)/);
		if (closingParen) {
			lastIndex += closingParen[0].length;
		}
		callStartRe.lastIndex = lastIndex;
	}

	// Remaining text after last call
	const after = text.slice(lastIndex).trim();
	if (after) {
		parts.push(after);
		chunks.push({ type: 'prose', text: after });
	}

	return {
		calls,
		cleanedText: parts.join(' ').trim(),
		chunks
	};
}

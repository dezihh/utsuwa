import type { SpeechSegment } from '../voice-orchestrator.ts';
import { findClosingBrace, parseJsonArgs } from './speech-compiler.ts';
import { splitIntoSegments, stripSpeechArtifacts, stripForSpeech } from '../../utils/sentences.ts';

export interface StreamingSpeechBufferOptions {
	defaultLanguage?: string;
	streaming?: boolean;
	onSegment: (segment: SpeechSegment) => void;
}

/**
 * Buffers streaming LLM text and emits SpeechSegments as soon as complete
 * sentences are available. A flush timer ensures trailing text without a
 * sentence terminator is still emitted after a short timeout.
 *
 * For OmniVoice the buffer also recognises language-marked tool calls of the
 * form `speak({"text":"...","lang":"xx"})` and the common inline tag form
 * `<lang code="xx">...</lang>`. Complete markup is emitted immediately;
 * incomplete markup suppresses the plaintext flush timer so raw syntax is
 * never spoken.
 */
export class StreamingSpeechBuffer {
	private buffer = '';
	private emittedLength = 0;
	// Tracks depth of curly braces so JSON state-update blocks that span
	// multiple streaming chunks are held back from TTS until fully received.
	private jsonDepth = 0;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly FLUSH_TIMEOUT_MS = 1500;
	private readonly options: StreamingSpeechBufferOptions;

	constructor(options: StreamingSpeechBufferOptions) {
		this.options = options;
	}

	feed(chunk: string): void {
		// Track curly-brace depth across chunks so we never emit text that is
		// inside an open JSON state-update block.
		for (const ch of chunk) {
			if (ch === '{') this.jsonDepth++;
			else if (ch === '}') this.jsonDepth--;
		}
		this.buffer += chunk;

		// Markup mode takes precedence: once we see speak(/pause(/gesture(
		// or <lang code="xx"> tags we only emit complete markup and never fall
		// back to sentence-based plaintext emission, which would speak raw syntax.
		const hadMarkup = this.tryEmitLanguageTags() || this.tryEmitLanguageCalls();
		if (hadMarkup) {
			this.clearFlushTimer();
			return;
		}

		this.tryEmit();
		this.armFlushTimer();
	}

	flush(): void {
		this.tryEmitLanguageTags();
		this.tryEmitLanguageCalls();
		const remaining = this.buffer.slice(this.emittedLength).trim();

		// Only speak remaining plaintext if it does not contain raw or incomplete
		// markup syntax. Anything that looks like a call or tag has already been
		// handled; leftover fragments are discarded.
		if (remaining && !this.hasIncompleteMarkup(remaining)) {
			const { cleaned } = stripForSpeech(remaining);
			for (const seg of splitIntoSegments(cleaned.trim(), this.options.defaultLanguage)) {
				this.options.onSegment(seg);
			}
		}

		// Only mark the whole buffer as processed when no incomplete markup
		// remains. If raw syntax is left, later chunks may complete it; at
		// end-of-stream the buffer is discarded anyway.
		if (!this.hasIncompleteMarkup(this.buffer.slice(this.emittedLength))) {
			this.emittedLength = this.buffer.length;
		}

		this.jsonDepth = 0;
		this.clearFlushTimer();
	}

	reset(): void {
		this.buffer = '';
		this.emittedLength = 0;
		this.jsonDepth = 0;
		this.clearFlushTimer();
	}

	private tryEmit(): void {
		this.clearFlushTimer();

		let unprocessed = this.buffer.slice(this.emittedLength);
		while (unprocessed.length > 0) {
			const before = this.emittedLength;
			this.tryEmitBlock(unprocessed);
			if (this.emittedLength === before) break; // no sentence boundary found
			unprocessed = this.buffer.slice(this.emittedLength);
		}

		if (this.emittedLength < this.buffer.length) {
			this.armFlushTimer();
		}
	}

	private armFlushTimer(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flush();
		}, this.FLUSH_TIMEOUT_MS);
	}

	private clearFlushTimer(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}

	private emit(block: string): void {
		const { cleaned } = stripForSpeech(block);
		for (const seg of splitIntoSegments(cleaned, this.options.defaultLanguage)) {
			this.options.onSegment(seg);
		}
	}

	private tryEmitBlock(text: string): void {
		// While we are inside an open JSON state-update block, do not emit anything
		// that follows the opening brace. Content before the brace is still safe to
		// emit (e.g. a completed sentence before a state-update block starts).
		if (this.jsonDepth > 0) {
			const braceIndex = text.indexOf('{');
			if (braceIndex <= 0) return;
			text = text.slice(0, braceIndex);
		}

		// Strip any completed JSON state-update block(s) from the current tail.
		// Use the non-trimming variant so trailing whitespace is preserved for the
		// next streaming chunk.
		const { cleaned } = stripSpeechArtifacts(text);
		if (cleaned !== text) {
			this.buffer = this.buffer.slice(0, this.emittedLength) + cleaned;
			text = cleaned;
		}

		const paraBreak = text.indexOf('\n\n');
		if (paraBreak > 0) {
			const block = text.slice(0, paraBreak);
			if (block.trim()) {
				this.emit(block);
				this.emittedLength += paraBreak + 2;
			}
			return;
		}

		const singleBreak = text.indexOf('\n');
		if (singleBreak > 0) {
			const block = text.slice(0, singleBreak);
			if (block.trim()) {
				this.emit(block);
				this.emittedLength += singleBreak + 1;
			}
			return;
		}

		// Emit up to the first sentence boundary so TTS can start immediately.
		const sentenceEnd = /([.!?…])(\s+|$)/;
		const m = sentenceEnd.exec(text);
		if (!m) return;

		const firstEnd = m.index + m[0].length;
		const block = text.slice(0, firstEnd);
		if (block.trim()) {
			this.emit(block);
			this.emittedLength += firstEnd;
		}
	}

	/**
	 * Scans the unprocessed buffer for complete OmniVoice-style tool calls
	 * (`speak(...)`, `pause(...)`, `gesture(...)`). Emits each complete speak
	 * call as a SpeechSegment, emits plaintext that precedes a complete call,
	 * and advances `emittedLength` past consumed content.
	 *
	 * Returns `true` when the buffer is in tool-call mode, i.e. when at least
	 * one complete call was emitted or an incomplete call opening remains. In
	 * that mode the caller must not fall back to plaintext sentence emission.
	 */
	private tryEmitLanguageCalls(): boolean {
		const unprocessed = this.buffer.slice(this.emittedLength);
		const callStartRe = /(speak|pause|gesture)\s*\(/g;

		let consumed = 0;
		let hadToolCall = false;
		let match: RegExpExecArray | null;

		while ((match = callStartRe.exec(unprocessed)) !== null) {
			const name = match[1];
			const argsStart = match.index + match[0].length;

			// Only accept object-literal arguments; skip things like speak("text").
			const wsMatch = unprocessed.slice(argsStart).match(/\S/);
			if (!wsMatch || wsMatch[0] !== '{') continue;
			const objStart = argsStart + wsMatch.index!;

			const objEnd = findClosingBrace(unprocessed, objStart);
			if (objEnd === null) {
				// Incomplete call: stay in tool-call mode and wait for more chunks.
				hadToolCall = true;
				break;
			}

			let after = objEnd + 1;
			const parenMatch = unprocessed.slice(after).match(/^\s*\)/);
			if (parenMatch) after += parenMatch[0].length;

			const before = unprocessed.slice(consumed, match.index).trim();
			if (before) this.emit(before);

			if (name === 'speak') {
				this.emitToolCall(unprocessed.slice(objStart, objEnd + 1));
			}

			consumed = after;
			hadToolCall = true;
			callStartRe.lastIndex = after;
		}

		this.emittedLength += consumed;

		const remaining = this.buffer.slice(this.emittedLength);
		const hasIncompletePattern = /(?:speak|pause|gesture)\s*\(/.test(remaining);

		return hadToolCall || hasIncompletePattern;
	}

	private emitToolCall(argsStr: string): void {
		const args = parseJsonArgs(argsStr);
		const text = typeof args.text === 'string' ? args.text.trim() : '';
		if (!text) return;

		const lang =
			typeof args.lang === 'string' && args.lang.length >= 2 && args.lang.length <= 5
				? args.lang
				: this.options.defaultLanguage || 'de';

		this.options.onSegment({ text, language: lang });
	}

	/**
	 * Scans for inline language tags such as `<lang code="es">...</lang>`.
	 * Emits each complete tag as a SpeechSegment, emits plaintext that precedes
	 * a tag, and advances `emittedLength` past consumed content.
	 *
	 * Returns `true` when the buffer is in tag mode (at least one complete tag
	 * emitted or an incomplete tag opening remains).
	 */
	private tryEmitLanguageTags(): boolean {
		const unprocessed = this.buffer.slice(this.emittedLength);
		const tagRe = /<lang\s+code=["']([a-zA-Z\-]{2,8})["']>([\s\S]*?)<\/lang>/g;

		let consumed = 0;
		let hadTag = false;
		let match: RegExpExecArray | null;

		while ((match = tagRe.exec(unprocessed)) !== null) {
			const before = unprocessed.slice(consumed, match.index).trim();
			if (before) this.emit(before);

			const text = match[2].trim();
			if (text) {
				this.options.onSegment({ text, language: match[1] });
			}

			consumed = match.index + match[0].length;
			hadTag = true;
			tagRe.lastIndex = consumed;
		}

		// If an incomplete <lang ...> opening follows, emit the plaintext before
		// it so primary-language text is not held back while waiting for the
		// closing </lang>.
		const incompleteIndex = unprocessed.search(/<lang(\s+code=["']?)?/i);
		if (incompleteIndex !== -1 && incompleteIndex > consumed) {
			const before = unprocessed.slice(consumed, incompleteIndex).trim();
			if (before) this.emit(before);
			consumed = incompleteIndex;
			hadTag = true;
		}

		this.emittedLength += consumed;
		return hadTag;
	}

	private hasIncompleteMarkup(text: string): boolean {
		return /(?:speak|pause|gesture)\s*\(/.test(text) || /<lang(\s+code=["']?)?/i.test(text);
	}
}

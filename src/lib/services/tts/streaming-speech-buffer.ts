import type { SpeechSegment } from '../voice-orchestrator.ts';
import { splitIntoSegments, stripForSpeech } from '../../utils/sentences.ts';

export interface StreamingSpeechBufferOptions {
	defaultLanguage?: string;
	streaming?: boolean;
	onSegment: (segment: SpeechSegment) => void;
}

export class StreamingSpeechBuffer {
	private buffer = '';
	private emittedLength = 0;
	// Tracks depth of curly braces so JSON state-update blocks that span
	// multiple streaming chunks are held back from TTS until fully received.
	private jsonDepth = 0;
	// Accumulates [lang:xx] / [voice:xxx] tags that were consumed at position 0
	// so they can be prepended to the next emitted text block. Without this,
	// a leading [lang:es] would be discarded and the following text would be
	// synthesised with the wrong language.
	private pendingStatePrefix = '';
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
		this.tryEmit();
		this.armFlushTimer();
	}

	flush(): void {
		let remaining = (this.pendingStatePrefix + this.buffer.slice(this.emittedLength)).trim();
		if (!remaining) return;

		// Ensure any trailing JSON state-update block is stripped before TTS.
		const { cleaned } = stripForSpeech(remaining);
		remaining = cleaned.trim();
		if (!remaining) {
			this.emittedLength = this.buffer.length;
			this.pendingStatePrefix = '';
			this.jsonDepth = 0;
			return;
		}

		for (const seg of splitIntoSegments(remaining, this.options.defaultLanguage, false)) {
			this.options.onSegment(seg);
		}
		this.emittedLength = this.buffer.length;
		this.pendingStatePrefix = '';
		this.jsonDepth = 0;
	}

	reset(): void {
		this.buffer = '';
		this.emittedLength = 0;
		this.pendingStatePrefix = '';
	}

	private tryEmit(): void {
		this.clearFlushTimer();

		// Loop so that when multiple complete sentences are buffered (e.g. fast LLM),
		// each is emitted individually in sequence rather than as one big block.
		let unprocessed = this.buffer.slice(this.emittedLength);
		while (unprocessed.length > 0) {
			const before = this.emittedLength;
			this.tryEmitBlock(unprocessed);
			if (this.emittedLength === before) break; // no sentence boundary found
			unprocessed = this.buffer.slice(this.emittedLength);
		}

		// Re-arm the flush timer if there is un-emitted text remaining.
		// This ensures trailing text without a sentence terminator is eventually
		// emitted rather than waiting indefinitely for more streaming chunks.
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
		const textWithState = this.pendingStatePrefix + block;
		this.pendingStatePrefix = '';
		for (const seg of splitIntoSegments(textWithState, this.options.defaultLanguage, false)) {
			this.options.onSegment(seg);
		}
	}

	private tryEmitBlock(text: string): void {
		// While we are inside an open JSON state-update block, do not emit anything.
		// The block may span multiple streaming chunks.
		if (this.jsonDepth > 0) return;

		// Strip any completed JSON state-update block(s) from the current tail so
		// they are never passed to TTS. If stripping changes the text, rewrite the
		// buffer tail to match the cleaned version.
		const { cleaned } = stripForSpeech(text);
		if (cleaned !== text) {
			this.buffer = this.buffer.slice(0, this.emittedLength) + cleaned;
			text = cleaned;
		}

		const TAG_RE = /\[lang:\s*(?:default|[a-z]{2,3})\s*\]|\[voice:\s*(?:default|alt)\s*\]/gi;

		// When a control tag sits at position 0, accumulate it in pendingStatePrefix
		// instead of discarding it — it will be prepended to the next text block so
		// splitIntoSegments assigns the correct language/voice to those segments.
		const leadingTag = TAG_RE.exec(text);
		TAG_RE.lastIndex = 0;
		if (leadingTag && leadingTag.index === 0) {
			this.pendingStatePrefix += leadingTag[0];
			this.emittedLength += leadingTag[0].length;
			return; // tryEmit() will call us again with text after the tag
		}

		// Emit text that precedes a control tag as its own block so the tag's
		// state change applies cleanly to the following content.
		const tagBoundaryMatch = TAG_RE.exec(text);
		if (tagBoundaryMatch && tagBoundaryMatch.index > 0) {
			const block = text.slice(0, tagBoundaryMatch.index);
			if (block.trim()) {
				this.emit(block);
				this.emittedLength += tagBoundaryMatch.index;
			}
			return;
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

		// Emit on a single newline as well so streamed responses that use \n
		// as a natural break (e.g. lists, multi-sentence paragraphs) are split
		// into smaller chunks for TTS without waiting for a full sentence end.
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
		// tryEmit() loops and calls us again for the next sentence.
		// Match sentence-ending punctuation followed by whitespace OR end-of-string,
		// so a sentence that ends at the current buffer tail is emitted right away
		// instead of waiting indefinitely for more text that may never arrive.
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
}

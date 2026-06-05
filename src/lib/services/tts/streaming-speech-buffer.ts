import type { SpeechSegment } from '../voice-orchestrator.ts';
import { splitIntoSegments } from '../../utils/sentences.ts';

export interface StreamingSpeechBufferOptions {
	defaultLanguage?: string;
	streaming?: boolean;
	onSegment: (segment: SpeechSegment) => void;
}

export class StreamingSpeechBuffer {
	private buffer = '';
	private emittedLength = 0;
	private readonly options: StreamingSpeechBufferOptions;

	constructor(options: StreamingSpeechBufferOptions) {
		this.options = options;
	}

	feed(chunk: string): void {
		this.buffer += chunk;
		this.tryEmit();
	}

	flush(): void {
		const remaining = this.buffer.slice(this.emittedLength).trim();
		if (!remaining) return;

		for (const seg of splitIntoSegments(remaining, this.options.defaultLanguage, false)) {
			this.options.onSegment(seg);
		}
		this.emittedLength = this.buffer.length;
	}

	reset(): void {
		this.buffer = '';
		this.emittedLength = 0;
	}

	private tryEmit(): void {
		// Loop so that when multiple complete sentences are buffered (e.g. fast LLM),
		// each is emitted individually in sequence rather than as one big block.
		let unprocessed = this.buffer.slice(this.emittedLength);
		while (unprocessed.length > 0) {
			const before = this.emittedLength;
			this.tryEmitBlock(unprocessed);
			if (this.emittedLength === before) break; // no sentence boundary found
			unprocessed = this.buffer.slice(this.emittedLength);
		}
	}

	private tryEmitBlock(text: string): void {
		const TAG_RE = /\[lang:[a-z]{2,3}\]|\[voice:(?:default|alt)\]/gi;

		// When a control tag sits at position 0, it's just a state-change marker —
		// consume it immediately so it doesn't stall subsequent sentence detection.
		const leadingTag = TAG_RE.exec(text);
		TAG_RE.lastIndex = 0;
		if (leadingTag && leadingTag.index === 0) {
			this.emittedLength += leadingTag[0].length;
			return; // tryEmit() will call us again with text after the tag
		}

		// Emit text that precedes a control tag as its own block so the tag's
		// state change applies cleanly to the following content.
		const tagBoundaryMatch = TAG_RE.exec(text);
		if (tagBoundaryMatch && tagBoundaryMatch.index > 0) {
			const block = text.slice(0, tagBoundaryMatch.index);
			if (block.trim()) {
				for (const seg of splitIntoSegments(block, this.options.defaultLanguage, false)) {
					this.options.onSegment(seg);
				}
				this.emittedLength += tagBoundaryMatch.index;
			}
			return;
		}

		const paraBreak = text.indexOf('\n\n');
		if (paraBreak > 0) {
			const block = text.slice(0, paraBreak);
			if (block.trim()) {
				for (const seg of splitIntoSegments(block, this.options.defaultLanguage, false)) {
					this.options.onSegment(seg);
				}
				this.emittedLength += paraBreak + 2;
			}
			return;
		}

		// Emit up to the first sentence boundary so TTS can start immediately.
		// tryEmit() loops and calls us again for the next sentence.
		const sentenceEnd = /([.!?…])\s+/;
		const m = sentenceEnd.exec(text);
		if (!m) return;

		const firstEnd = m.index + m[0].length;
		if (firstEnd < 8) return; // too short — wait for more text

		const block = text.slice(0, firstEnd);
		if (block.trim()) {
			for (const seg of splitIntoSegments(block, this.options.defaultLanguage, false)) {
				this.options.onSegment(seg);
			}
			this.emittedLength += firstEnd;
		}
	}
}

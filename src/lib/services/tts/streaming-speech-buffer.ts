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
		const langMatch = /\[lang:[a-z]{2,3}\]/gi.exec(text);
		if (langMatch && langMatch.index > 0) {
			const block = text.slice(0, langMatch.index);
			if (block.trim()) {
				for (const seg of splitIntoSegments(block, this.options.defaultLanguage, false)) {
					this.options.onSegment(seg);
				}
				this.emittedLength += langMatch.index;
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

		// Emit only up to the FIRST sentence boundary so that Chatterbox can start
		// synthesising sentence 1 immediately, without waiting for the last sentence.
		// tryEmit() loops and calls us again for sentence 2, 3, … in sequence.
		const sentenceEnd = /([.!?…])\s+/;
		const m = sentenceEnd.exec(text);
		if (!m) return;

		const firstEnd = m.index + m[0].length;
		if (firstEnd < 20) return; // too short — wait for more text

		const block = text.slice(0, firstEnd);
		if (block.trim()) {
			for (const seg of splitIntoSegments(block, this.options.defaultLanguage, false)) {
				this.options.onSegment(seg);
			}
			this.emittedLength += firstEnd;
		}
	}
}

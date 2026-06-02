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
		const unprocessed = this.buffer.slice(this.emittedLength);
		if (!unprocessed) return;

		this.tryEmitBlock(unprocessed);
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

		const sentenceEnd = /([.!?…])\s+/g;
		let lastEnd = -1;
		let m: RegExpExecArray | null;

		while ((m = sentenceEnd.exec(text)) !== null) {
			lastEnd = m.index + m[0].length;
		}

		if (lastEnd > 20) {
			const block = text.slice(0, lastEnd);
			if (block.trim()) {
				for (const seg of splitIntoSegments(block, this.options.defaultLanguage, false)) {
					this.options.onSegment(seg);
				}
				this.emittedLength += lastEnd;
			}
		}
	}
}

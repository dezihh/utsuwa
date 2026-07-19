import type { CompiledSegment } from './speech-compiler.ts';
import type { SpeechSegment } from '../voice-orchestrator.ts';
import type { VoiceOrchestrator } from '../voice-orchestrator.ts';
import type { TTSOptions } from './index.ts';

export interface GestureStore {
	active: boolean;
	type?: string;
}

export interface SubtitleStore {
	visible: boolean;
	text?: string;
	language?: string;
}

export interface SchedulerStores {
	gesture: GestureStore;
	subtitle: SubtitleStore;
}

/**
 * Thin adapter: translates CompiledSegment[] into VoiceOrchestrator calls
 * and publishes gesture/subtitle events to Svelte stores.
 *
 * The VoiceOrchestrator handles:
 *  - Pipelining (synth N+1 while play N)
 *  - Interrupt handling
 *  - Audio context management
 *  - Voice mapping (language → voiceId + instructions)
 */
export class SpeechScheduler {
	private orchestrator: VoiceOrchestrator;
	private storeGesture: GestureStore;
	private storeSubtitle: SubtitleStore;
	private gestureTimers: number[] = [];
	private aborted = false;

	constructor(orchestrator: VoiceOrchestrator) {
		this.orchestrator = orchestrator;
		this.storeGesture = { active: false };
		this.storeSubtitle = { visible: false };
	}

	getStores(): SchedulerStores {
		return {
			gesture: this.storeGesture,
			subtitle: this.storeSubtitle
		};
	}

	async beginPlan(segments: CompiledSegment[], options: TTSOptions): Promise<void> {
		this.aborted = false;
		this.clearGestureTimers();

		const speechSegments: SpeechSegment[] = [];
		for (const seg of segments) {
			if (this.aborted) break;

			if (seg.type === 'gesture') {
				this.scheduleGesture(seg);
				continue;
			}
			if (seg.type === 'pause') {
				if (seg.durationMs && seg.durationMs > 0) {
					await this.delay(seg.durationMs);
				}
				continue;
			}
			// speak
			this.storeSubtitle.visible = true;
			this.storeSubtitle.text = seg.text;
			this.storeSubtitle.language = seg.language;

			speechSegments.push({
				text: seg.text ?? '',
				language: seg.language
			});
		}

		if (speechSegments.length === 0) {
			this.storeSubtitle.visible = false;
			return;
		}

		// Use the existing orchestrator pipeline.
		// It handles voiceId/instructions mapping internally.
		await this.orchestrator.speakSegments(speechSegments, options, {
			onSegmentStart: (segment: SpeechSegment) => {
				this.storeSubtitle.text = segment.text;
			},
			onComplete: () => {
				this.storeSubtitle.visible = false;
				this.clearGestureTimers();
			}
		});
	}

	interrupt(): void {
		this.aborted = true;
		this.orchestrator.interrupt();
		this.storeSubtitle.visible = false;
		this.clearGestureTimers();
	}

	private scheduleGesture(seg: CompiledSegment): void {
		this.storeGesture.active = true;
		this.storeGesture.type = seg.gestureType;

		const duration = seg.durationMs ?? 1500;
		const timer = window.setTimeout(() => {
			this.storeGesture.active = false;
		}, duration);
		this.gestureTimers.push(timer);
	}

	private clearGestureTimers(): void {
		for (const t of this.gestureTimers) {
			clearTimeout(t);
		}
		this.gestureTimers = [];
		this.storeGesture.active = false;
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const timer = window.setTimeout(resolve, ms);
			this.gestureTimers.push(timer);
		});
	}
}
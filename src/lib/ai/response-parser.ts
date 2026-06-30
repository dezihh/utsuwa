import type { StateUpdates, Emotion } from '$lib/types/character';

// Parsed response structure
export interface ParsedResponse {
	dialogue: string;
	stateUpdates: Partial<StateUpdates> | null;
	parseError?: string;
}

// LLM JSON output structure
interface LLMStateOutput {
	mood_change?: {
		emotion: string;
		intensity_delta?: number;
	};
	affection_delta?: number;
	trust_delta?: number;
	intimacy_delta?: number;
	comfort_delta?: number;
	respect_delta?: number;
	new_memory?: string | null;
	new_inside_joke?: string | null;
	triggered_event?: string | null;
	structured_fact_seen?: {
		type: string;
		key: string;
		value: string;
		category?: string;
		tags?: string[];
	} | null;
}

// Valid emotions for validation
const VALID_EMOTIONS: Emotion[] = [
	'happy',
	'sad',
	'excited',
	'anxious',
	'content',
	'frustrated',
	'curious',
	'affectionate',
	'playful',
	'melancholy',
	'flustered',
	'neutral'
];

// Parse LLM response to extract dialogue and state updates
export function parseResponse(rawResponse: string): ParsedResponse {
	// Default result
	let dialogue = rawResponse.trim();
	let stateUpdates: Partial<StateUpdates> | null = null;
	let parseError: string | undefined;

	// Try to extract JSON block
	const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/i);

	if (jsonMatch) {
		// Remove JSON block from dialogue
		dialogue = rawResponse.replace(jsonMatch[0], '').trim();

		try {
			const parsed: LLMStateOutput = JSON.parse(jsonMatch[1]);
			stateUpdates = convertLLMOutput(parsed);
		} catch (e) {
			parseError = `Failed to parse JSON: ${e instanceof Error ? e.message : 'Unknown error'}`;
			console.debug('Failed to parse LLM state updates:', e);
		}
	} else {
		// Try to find inline JSON (some models don't use code blocks)
		const inlineJsonMatch = rawResponse.match(
			/\{[\s\S]*"(?:mood_change|affection_delta|trust_delta|intimacy_delta|comfort_delta|respect_delta|new_memory|structured_fact_seen|triggered_event)"[\s\S]*\}/
		);
		if (inlineJsonMatch) {
			dialogue = rawResponse.replace(inlineJsonMatch[0], '').trim();
			try {
				const parsed: LLMStateOutput = JSON.parse(inlineJsonMatch[0]);
				stateUpdates = convertLLMOutput(parsed);
			} catch (e) {
				// Ignore parse errors for inline JSON - might be false positive
			}
		} else {
			// Third fallback: bare JSON object anywhere in the response
			// (some models output JSON without code fences or known keys)
			const bareJsonMatch = rawResponse.match(/(\{[\s\S]*\})\s*$/);
			if (bareJsonMatch) {
				try {
					const parsed: LLMStateOutput = JSON.parse(bareJsonMatch[1]);
					const knownKeys = [
						'mood_change',
						'affection_delta',
						'trust_delta',
						'intimacy_delta',
						'comfort_delta',
						'respect_delta',
						'new_memory',
						'structured_fact_seen',
						'triggered_event'
					];
					if (knownKeys.some((k) => k in parsed)) {
						dialogue = rawResponse.replace(bareJsonMatch[0], '').trim();
						stateUpdates = convertLLMOutput(parsed);
					}
				} catch {
					// Not valid JSON — ignore
				}
			}
		}
	}


	// Fourth fallback: isolated memory tags that the model emitted without
	// wrapping them in a full JSON object (e.g. inline "new_memory": "...").
	if (!stateUpdates) {
		const isolatedMemoryMatch = rawResponse.match(
			/"?new_memory"?\s*:\s*"([\s\S]*?)(?<!\\)"/i
		);
		if (isolatedMemoryMatch) {
			dialogue = rawResponse.replace(isolatedMemoryMatch[0], '').trim();
			stateUpdates = { newMemory: isolatedMemoryMatch[1].trim() };
		}
	}

	if (!stateUpdates) {
		const isolatedFactMatch = rawResponse.match(
			/"?structured_fact_seen"?\s*:\s*(\{[\s\S]*?\})/i
		);
		if (isolatedFactMatch) {
			try {
				const parsed: LLMStateOutput = JSON.parse(
					`{"structured_fact_seen": ${isolatedFactMatch[1]}}`
				);
				dialogue = rawResponse.replace(isolatedFactMatch[0], '').trim();
				stateUpdates = convertLLMOutput(parsed);
			} catch {
				// Not valid JSON — ignore
			}
		}
	}
	// Clean up dialogue
	dialogue = cleanDialogue(dialogue);

	return { dialogue, stateUpdates, parseError };
}

// Convert LLM output format to our StateUpdates format
function convertLLMOutput(output: LLMStateOutput): Partial<StateUpdates> {
	const updates: Partial<StateUpdates> = {};

	// Convert mood change
	if (output.mood_change) {
		const emotion = output.mood_change.emotion?.toLowerCase() as Emotion;
		if (VALID_EMOTIONS.includes(emotion)) {
			updates.moodChange = {
				emotion,
				intensityDelta: clampDelta(output.mood_change.intensity_delta, -30, 30)
			};
		}
	}

	// Convert stat deltas with bounds
	if (output.affection_delta !== undefined) {
		updates.affectionDelta = clampDelta(output.affection_delta, -20, 20);
	}

	if (output.trust_delta !== undefined) {
		updates.trustDelta = clampDelta(output.trust_delta, -10, 10);
	}

	if (output.intimacy_delta !== undefined) {
		updates.intimacyDelta = clampDelta(output.intimacy_delta, -10, 10);
	}

	if (output.comfort_delta !== undefined) {
		updates.comfortDelta = clampDelta(output.comfort_delta, -10, 10);
	}

	if (output.respect_delta !== undefined) {
		updates.respectDelta = clampDelta(output.respect_delta, -10, 10);
	}

	// Pass through memory and event suggestions
	if (output.new_memory && typeof output.new_memory === 'string') {
		updates.newMemory = output.new_memory.trim();
	}

	if (output.triggered_event && typeof output.triggered_event === 'string') {
		updates.triggeredEvent = output.triggered_event.trim();
	}

	// Structured fact for fact library.
	// Vocabulary words are handled by the vocabulary system and must NOT create
	// duplicate structured facts, even if the model emits them.
	if (output.structured_fact_seen && typeof output.structured_fact_seen === 'object') {
		const fact = output.structured_fact_seen;
		if (
			typeof fact.key === 'string' &&
			typeof fact.value === 'string' &&
			typeof fact.type === 'string' &&
			fact.type.toLowerCase() !== 'vocab'
		) {
			updates.structuredFactSeen = {
				type: fact.type,
				key: fact.key.trim(),
				value: fact.value.trim(),
				category: typeof fact.category === 'string' ? fact.category.trim() : undefined,
				tags: Array.isArray(fact.tags) ? fact.tags.filter((t): t is string => typeof t === 'string') : undefined
			};
		}
	}

	return updates;
}

// Clamp a delta value
function clampDelta(value: number | undefined, min: number, max: number): number {
	if (value === undefined || isNaN(value)) return 0;
	return Math.max(min, Math.min(max, Math.round(value)));
}

// Application control tags that must be stripped from visible chat text
// AFTER the calling code has extracted them. Tags like [search_image:...],
// [reminder:...], and [vocab:...] are handled by extractImageSearchTags,
// extractReminderTags, and extractVocabTags respectively — they are NOT
// stripped here because those extractors run on the dialogue output and
// return their own cleanedText.
//
// Only tags consumed during streaming (TTS, voice, actions) or purely
// cosmetic tags ([emote:...]) are stripped here.
const APP_TAG_PATTERNS: RegExp[] = [
	/\[lang:\s*(?:default|[a-z]{2,3})\s*\]/gi,
	/\[voice:\s*(?:default|alt)\s*\]/gi,
	/\[action:[^\]]+\]/gi,
	/\[emote:[^\]]+\]/gi,
	/\[laugh\]/gi,
	/\[giggle\]/gi,
	/\[chuckle\]/gi,
	/\[sigh\]/gi,
	/\[excited\]/gi,
	/\[sad\]/gi,
	/\[calm\]/gi,
	/\[whisper\]/gi,
	/\[dramatic\]/gi,
	/\[surprised\]/gi,
	/\[shocked\]/gi,
	/\[confused\]/gi,
	/\[nervous\]/gi,
	/\[shy\]/gi,
	/\[annoyed\]/gi,
	/\[frustrated\]/gi,
	/\[cry\]/gi,
	/\[yawn\]/gi,
	/\[slow\]/gi,
	/\[fast\]/gi,
	/\[laughter\]/gi,
	/\[surprise-oh\]/gi,
	/\[surprise-ah\]/gi,
	/\[dissatisfaction-hnn\]/gi,
	/\[confirmation-en\]/gi
];

function stripAllTags(text: string): string {
	let result = text;
	for (const pattern of APP_TAG_PATTERNS) {
		result = result.replace(pattern, '');
	}
	return result;
}

// Clean up dialogue text
function cleanDialogue(text: string): string {
	let cleaned = text;

	// Remove all application control tags from visible chat
	cleaned = stripAllTags(cleaned);

	// Remove any leftover JSON-like content (valid or broken fragments)
	cleaned = cleaned.replace(/\{[^}]*"(?:mood|delta|emotion)[^}]*\}/gi, '');
	cleaned = cleaned.replace(/\{[^{}]*"(?:new_memory|structured_fact_seen|triggered_event|mood_change|affection_delta|trust_delta|intimacy_delta|comfort_delta|respect_delta)[^{}]*\}/gi, '');
	// Broken fragments without opening braces (model sometimes emits these at the end)
	cleaned = cleaned.replace(/\s*"?(new_memory|structured_fact_seen|mood_change|affection_delta|trust_delta|intimacy_delta|comfort_delta|respect_delta|energy_delta|triggered_event)"?\s*[:=].*$/gis, '');
	cleaned = cleaned.replace(/\s*"?(value|category|type|key)"?\s*[:=]\s*("[\s\S]*?"|\{[\s\S]*?\}).*$/gis, '');



	// Remove character name prefixes (e.g., "Character: ")
	cleaned = cleaned.replace(/^[A-Za-z]+:\s*/gm, '');

	// Clean up whitespace
	cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
	cleaned = cleaned.trim();

	// If we stripped everything, return a fallback
	if (!cleaned) {
		cleaned = 'Hmm...';
	}

	return cleaned;
}

// Validate state updates (sanity check)
export function validateStateUpdates(updates: Partial<StateUpdates>): {
	valid: boolean;
	sanitized: Partial<StateUpdates>;
	warnings: string[];
} {
	const warnings: string[] = [];
	const sanitized: Partial<StateUpdates> = {};

	// Validate mood change
	if (updates.moodChange) {
		if (VALID_EMOTIONS.includes(updates.moodChange.emotion)) {
			sanitized.moodChange = {
				emotion: updates.moodChange.emotion,
				intensityDelta: clampDelta(updates.moodChange.intensityDelta, -30, 30),
				cause: updates.moodChange.cause
			};
		} else {
			warnings.push(`Invalid emotion: ${updates.moodChange.emotion}`);
		}
	}

	// Validate numeric deltas
	if (updates.affectionDelta !== undefined) {
		if (Math.abs(updates.affectionDelta) > 50) {
			warnings.push(`Affection delta too large: ${updates.affectionDelta}`);
		}
		sanitized.affectionDelta = clampDelta(updates.affectionDelta, -20, 20);
	}

	if (updates.trustDelta !== undefined) {
		if (Math.abs(updates.trustDelta) > 20) {
			warnings.push(`Trust delta too large: ${updates.trustDelta}`);
		}
		sanitized.trustDelta = clampDelta(updates.trustDelta, -10, 10);
	}

	if (updates.intimacyDelta !== undefined) {
		sanitized.intimacyDelta = clampDelta(updates.intimacyDelta, -10, 10);
	}

	if (updates.comfortDelta !== undefined) {
		sanitized.comfortDelta = clampDelta(updates.comfortDelta, -10, 10);
	}

	if (updates.respectDelta !== undefined) {
		sanitized.respectDelta = clampDelta(updates.respectDelta, -10, 10);
	}

	// Pass through strings
	if (updates.newMemory) {
		sanitized.newMemory = updates.newMemory;
	}

	if (updates.triggeredEvent) {
		sanitized.triggeredEvent = updates.triggeredEvent;
	}

	// Validate structured fact
	if (updates.structuredFactSeen) {
		const fact = updates.structuredFactSeen;
		if (fact.key && fact.value && fact.type) {
			sanitized.structuredFactSeen = fact;
		} else {
			warnings.push('structuredFactSeen missing required fields (key, value, type)');
		}
	}

	return {
		valid: warnings.length === 0,
		sanitized,
		warnings
	};
}

// Extract potential facts from response (for memory system)
export function extractPotentialFacts(dialogue: string, userMessage: string): string[] {
	const facts: string[] = [];

	// User self-statements (first person)
	const userSelfPatterns = [
		/\bI(?:'m| am)\s+(?:a |an )?([^.!?,]+)/gi,
		/\bmy (?:name|job|hobby|favorite|family) is\s+([^.!?,]+)/gi,
		/\bI (?:work|live|study) (?:at|in|as)\s+([^.!?,]+)/gi,
		/\bI (?:like|love|enjoy|hate|prefer)\s+([^.!?,]+)/gi
	];

	for (const pattern of userSelfPatterns) {
		let match;
		while ((match = pattern.exec(userMessage)) !== null) {
			const fact = match[match.length - 1].trim();
			if (fact.length > 2) {
				facts.push(`User: ${fact}`);
			}
		}
	}

	// AI perspective patterns (from dialogue)
	const aiPerspectivePatterns = [
		/you (?:are|work as|live in|like|love|enjoy|hate|prefer|have)\s+([^.!?]+)/gi,
		/your (?:name|job|favorite|hobby|family|home|work)\s+(?:is|are)\s+([^.!?]+)/gi,
		/you (?:said|mentioned|told me)\s+(?:that\s+)?([^.!?]+)/gi
	];

	for (const pattern of aiPerspectivePatterns) {
		let match;
		while ((match = pattern.exec(dialogue)) !== null) {
			facts.push(match[1].trim());
		}
	}

	// Detect category-list format: "Category: value" or "- Category: value"
	const categoryPatterns = [
		/^[-•*]?\s*(?:vorlieben?|preferences?|likes?|hobbys?|hobbies|interessen?|interests?|beruf|job|arbeit|work)\s*:\s*(.+)$/gim,
		/^[-•*]?\s*(?:name|alter|age|wohnort|location|ziel|goal|geburtstag|birthday)\s*:\s*(.+)$/gim
	];

	for (const pattern of categoryPatterns) {
		let match;
		while ((match = pattern.exec(dialogue)) !== null) {
			const value = match[1].trim();
			if (value.length > 2 && value.length < 200) {
				facts.push(`User: ${value}`);
			}
		}
	}

	// Look for companion statements about remembering
	const rememberPatterns = [
		/I(?:'ll)? remember (?:that )?([^.!?]+)/gi,
		/I(?:'ll)? keep that in mind[.!]?\s*([^.!?]*)/gi,
		/noted[!.]?\s*([^.!?]*)/gi
	];

	for (const pattern of rememberPatterns) {
		let match;
		while ((match = pattern.exec(dialogue)) !== null) {
			if (match[1].trim()) {
				facts.push(match[1].trim());
			}
		}
	}

	return facts.filter((f) => f.length > 5 && f.length < 200);
}

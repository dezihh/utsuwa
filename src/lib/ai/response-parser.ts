import type { StateUpdates, Emotion } from '$lib/types/character';

// Parsed response structure
export interface ParsedResponse {
	dialogue: string;
	stateUpdates: Partial<StateUpdates> | null;
	/** Vocabulary mastery signals from the LLM, to be applied to familiarity scores. */
	vocabResults?: Array<{ word: string; known: boolean }>;
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
	/** Word-level mastery signals from a vocabulary exercise turn. */
	vocab_results?: Array<{ word: string; known: boolean }> | null;
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

// Common free-form / compound emotions weaker and RP-tuned models emit, mapped
// to our canonical set. Lets their mood signal land instead of being dropped.
const EMOTION_SYNONYMS: Record<string, Emotion> = {
	joy: 'happy', joyful: 'happy', glad: 'happy', cheerful: 'happy', pleased: 'happy',
	grateful: 'happy', thankful: 'happy', delighted: 'happy', proud: 'happy',
	excitement: 'excited', thrilled: 'excited', eager: 'excited', enthusiastic: 'excited',
	nervous: 'anxious', worried: 'anxious', scared: 'anxious', afraid: 'anxious',
	fearful: 'anxious', uneasy: 'anxious', tense: 'anxious', stressed: 'anxious',
	calm: 'content', relaxed: 'content', peaceful: 'content', satisfied: 'content',
	comfortable: 'content', 'cared-for': 'content', serene: 'content', reassured: 'content',
	angry: 'frustrated', annoyed: 'frustrated', irritated: 'frustrated', upset: 'frustrated',
	mad: 'frustrated', exasperated: 'frustrated',
	interested: 'curious', intrigued: 'curious', inquisitive: 'curious',
	loving: 'affectionate', warm: 'affectionate', tender: 'affectionate', fond: 'affectionate',
	caring: 'affectionate', affection: 'affectionate', adoring: 'affectionate',
	fun: 'playful', teasing: 'playful', mischievous: 'playful', silly: 'playful', cheeky: 'playful',
	down: 'melancholy', blue: 'melancholy', wistful: 'melancholy', nostalgic: 'melancholy',
	lonely: 'melancholy', somber: 'melancholy', gloomy: 'melancholy',
	unhappy: 'sad', hurt: 'sad', disappointed: 'sad', heartbroken: 'sad', sorrowful: 'sad',
	embarrassed: 'flustered', shy: 'flustered', bashful: 'flustered', blushing: 'flustered',
	fine: 'neutral', okay: 'neutral', indifferent: 'neutral'
};

// Resolve a model's emotion string to one of our canonical emotions, taking the
// first of a compound ("happy|curious", "warm, caring") and mapping synonyms.
function normalizeEmotion(raw: string | undefined): Emotion | null {
	if (!raw) return null;
	const first = raw.toLowerCase().trim().split(/[|/,]/)[0].trim();
	if (VALID_EMOTIONS.includes(first as Emotion)) return first as Emotion;
	return EMOTION_SYNONYMS[first] ?? null;
}

// Reasoning models (R1-style) emit a scratchpad before the answer. Strip it so
// the trace never reaches the chat bubble or the JSON parser.
function stripReasoning(text: string): string {
	let out = text.replace(/<think(?:ing)?>[\/s\S]*?<\/think(?:ing)?>/gi, '');
	const close = out.match(/<\/think(?:ing)?>/i);
	if (close && close.index !== undefined) {
		out = out.slice(close.index + close[0].length);
	}
	return out.trim();
}

// Chat-template / stop tokens some local GGUFs leak into their text output.
const END_OF_TURN_RE = /<\/s>|<\|im_end\|>|<\|eot_id\|>|<\|end_of_text\|>|<\|endoftext\|>|<end_of_turn>/i;
const STRAY_TOKEN_RE = /<\|[a-z0-9_]+\|>|<\/?s>|<\/?(?:bos|eos)>|<\/?(?:start|end)_of_turn>|\[\/?\ INST\]/gi;

function stripControlTokens(text: string): string {
	const idx = text.search(END_OF_TURN_RE);
	const cut = idx === -1 ? text : text.slice(0, idx);
	return cut.replace(STRAY_TOKEN_RE, '');
}

// The model sometimes keeps writing past its own reply and starts a new
// transcript turn as the user or a narrator. Cut at the first such turn on a
// LATER line (anchored to \n so the real reply on line one is never cut).
const HALLUCINATED_TURN_RE =
	/\n[ \t]*(?:(?:They|You|User|Human|Assistant|Narrator|System|AI)[ \t]*:[ \t]|[A-Z][\w''.-]{0,19}[ \t]*:[ \t]*["\u201c])/;

function cutHallucinatedTurn(text: string): string {
	const m = text.match(HALLUCINATED_TURN_RE);
	return m && m.index !== undefined ? text.slice(0, m.index) : text;
}

// JSON objects we care about carry at least one of these keys.
const STATE_KEY_RE =
	/"(?:mood_change|affection_delta|trust_delta|intimacy_delta|comfort_delta|respect_delta|new_memory|structured_fact_seen|vocab_results)"/;

// Scan from `start` (a '{') to its matching '}', ignoring braces inside strings.
function balancedObjectFrom(text: string, start: number): string | null {
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === '\\') esc = true;
			else if (ch === '"') inStr = false;
		} else if (ch === '"') inStr = true;
		else if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

function findStateObject(text: string): string | null {
	for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
		const obj = balancedObjectFrom(text, i);
		if (obj && STATE_KEY_RE.test(obj)) return obj;
	}
	return null;
}

// Tolerant JSON parse: strips comments and trailing commas, falls back to
// a balanced-brace scan so the state block survives surrounding prose.
function tryParseJson(text: string): LLMStateOutput | null {
	const repaired = text
		.replace(/\/\/[^\n\r]*/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/,\s*([}\]])/g, '$1')
		.trim();
	try {
		return JSON.parse(repaired) as LLMStateOutput;
	} catch {
		const obj = findStateObject(repaired);
		if (obj && obj !== repaired) {
			try {
				return JSON.parse(obj) as LLMStateOutput;
			} catch { /* give up */ }
		}
		return null;
	}
}

// Parse LLM response to extract dialogue and state updates
export function parseResponse(rawResponse: string): ParsedResponse {
	const raw = stripReasoning(rawResponse);
	let dialogue = raw.trim();
	let stateUpdates: Partial<StateUpdates> | null = null;
	let vocabResults: Array<{ word: string; known: boolean }> | undefined;
	let parseError: string | undefined;

	// Prefer a fenced ```json block; otherwise grab the first bare JSON object
	// that carries a state key (models that skip the fence).
	const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
	if (fenced) {
		const parsed = tryParseJson(fenced[1]);
		if (parsed) {
			stateUpdates = convertLLMOutput(parsed);
			vocabResults = extractVocabResults(parsed);
		} else {
			parseError = 'Failed to parse JSON state block';
			console.debug('Failed to parse LLM state updates:', fenced[1]);
		}
		dialogue = raw.replace(fenced[0], '').trim();
	} else {
		const obj = findStateObject(raw);
		if (obj) {
			const parsed = tryParseJson(obj);
			if (parsed) {
				stateUpdates = convertLLMOutput(parsed);
				vocabResults = extractVocabResults(parsed);
				dialogue = raw.replace(obj, '').trim();
			}
		}
	}

	dialogue = cleanDialogue(dialogue);
	return { dialogue, stateUpdates, vocabResults, parseError };
}

/** Extract and validate vocab_results from a parsed LLM JSON output. */
function extractVocabResults(
	output: LLMStateOutput
): Array<{ word: string; known: boolean }> | undefined {
	if (!Array.isArray(output.vocab_results)) return undefined;
	const results = output.vocab_results
		.filter((r) => r && typeof r.word === 'string' && typeof r.known === 'boolean')
		.map((r) => ({ word: (r.word as string).trim(), known: r.known as boolean }))
		.filter((r) => r.word.length > 0);
	return results.length > 0 ? results : undefined;
}

// Convert LLM output format to our StateUpdates format
function convertLLMOutput(output: LLMStateOutput): Partial<StateUpdates> {
	const updates: Partial<StateUpdates> = {};

	// Convert mood change — uses normalizeEmotion for synonym + compound handling
	if (output.mood_change) {
		const emotion = normalizeEmotion(output.mood_change.emotion);
		if (emotion) {
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
	// Cut runaway output at a leaked stop token and drop stray template tokens.
	let cleaned = stripControlTokens(text);

	// Cut if the model kept going as the user / a narrator instead of replying.
	cleaned = cutHallucinatedTurn(cleaned);

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

import type { SpeechSegment } from '$lib/services/voice-orchestrator';

type EmotionEntry = {
	ttsText: string;
	exaggeration?: number;
	displayText?: string;
	vrmExpression?: string;
	speed?: number;
};

const EMOTION_TTS_BY_LANG: Record<string, Partial<Record<string, string>>> = {
	default: {
		laugh: 'Hahaha,',
		giggle: 'Hehehe,',
		chuckle: 'Hm, haha,',
		sigh: 'Hmm...',
		cry: 'Sniff...',
		frustrated: 'Ugh,',
		annoyed: 'Tch,',
		surprised: 'Oh!',
		shocked: 'Wha—!',
		gasp: 'Ah!',
		sleepy: 'Mmh...',
		yawn: 'Aaahh...',
		shy: 'Um...',
		confused: 'Hmm?',
		nervous: 'Ehm...',
		unsure: 'Mm...',
		hum: 'Hmm hmm,',
		sing: 'La la la,',
		scream: 'Aaaah!'
	},
	de: {
		laugh: 'Hahaha,',
		giggle: 'Hihihi,',
		chuckle: 'Hehe,',
		sigh: 'Hach...',
		cry: 'Schnief...',
		frustrated: 'Pff,',
		annoyed: 'Tss,',
		surprised: 'Oh!',
		shocked: 'Was?!',
		gasp: 'Ah!',
		sleepy: 'Mhm...',
		yawn: 'Aaah...',
		shy: 'Ähm...',
		confused: 'Häh?',
		nervous: 'Äh...',
		unsure: 'Hmm...',
		hum: 'Hmm hmm,',
		sing: 'La la la,',
		scream: 'Aaah!'
	},
	es: {
		laugh: 'Jajaja,',
		giggle: 'Jejeje,',
		chuckle: 'Je, ja,',
		sigh: 'Ay...',
		cry: 'Snif...',
		frustrated: 'Uf,',
		annoyed: 'Tss,',
		surprised: '¡Oh!',
		shocked: '¡Qué!',
		gasp: '¡Ah!',
		sleepy: 'Mmm...',
		yawn: 'Aaah...',
		shy: 'Em...',
		confused: '¿Eh?',
		nervous: 'Eh...',
		unsure: 'Mm...',
		hum: 'Mm mm,',
		sing: 'La la la,',
		scream: '¡Aaah!'
	},
	fr: {
		laugh: 'Hahaha,',
		giggle: 'Héhéhé,',
		chuckle: 'Hé hé,',
		sigh: 'Pfff...',
		cry: 'Snif...',
		frustrated: 'Pfff,',
		annoyed: 'Tss,',
		surprised: 'Oh!',
		shocked: 'Quoi?!',
		gasp: 'Ah!',
		sleepy: 'Mmh...',
		yawn: 'Aaah...',
		shy: 'Euh...',
		confused: 'Hein?',
		nervous: 'Euh...',
		unsure: 'Hmm...',
		hum: 'Hm hm,',
		sing: 'La la la,',
		scream: 'Aaah!'
	},
	it: {
		laugh: 'Ahahah,',
		giggle: 'Eheheh,',
		chuckle: 'Eh eh,',
		sigh: 'Ahh...',
		cry: 'Snif...',
		frustrated: 'Uffa,',
		annoyed: 'Tze,',
		surprised: 'Oh!',
		shocked: 'Cosa?!',
		gasp: 'Ah!',
		sleepy: 'Mmh...',
		yawn: 'Aaah...',
		shy: 'Ehm...',
		confused: 'Eh?',
		nervous: 'Ehm...',
		unsure: 'Mah...',
		hum: 'Mm mm,',
		sing: 'La la la,',
		scream: 'Aaah!'
	},
	pt: {
		laugh: 'Hahaha,',
		giggle: 'Hehehe,',
		chuckle: 'Heh,',
		sigh: 'Ai...',
		cry: 'Snif...',
		frustrated: 'Pff,',
		annoyed: 'Tsc,',
		surprised: 'Oh!',
		shocked: 'O quê?!',
		gasp: 'Ah!',
		sleepy: 'Mmh...',
		yawn: 'Aaah...',
		shy: 'Hm...',
		confused: 'Hã?',
		nervous: 'Éh...',
		unsure: 'Hmm...',
		hum: 'Hm hm,',
		sing: 'La la la,',
		scream: 'Aaah!'
	},
	ja: {
		laugh: 'アハハ,',
		giggle: 'エヘヘ,',
		chuckle: 'フフ,',
		sigh: 'はぁ...',
		cry: 'えぐ...',
		frustrated: 'もう,',
		annoyed: 'ちっ,',
		surprised: 'えっ!',
		shocked: 'うそ!',
		gasp: 'あっ!',
		sleepy: 'むにゃ...',
		yawn: 'ふぁ...',
		shy: 'あの...',
		confused: 'えっと?',
		nervous: 'その...',
		unsure: 'うーん...',
		hum: 'フンフン,',
		sing: 'ラララ,',
		scream: 'きゃー!'
	},
	zh: {
		laugh: '哈哈哈,',
		giggle: '嘻嘻嘻,',
		chuckle: '呵呵,',
		sigh: '唉...',
		cry: '呜呜...',
		frustrated: '哎,',
		annoyed: '切,',
		surprised: '哦!',
		shocked: '什么?!',
		gasp: '啊!',
		sleepy: '嗯...',
		yawn: '啊...',
		shy: '那个...',
		confused: '嗯?',
		nervous: '那个...',
		unsure: '嗯...',
		hum: '嗯嗯,',
		sing: '啦啦啦,',
		scream: '啊啊啊!'
	},
	ko: {
		laugh: '하하하,',
		giggle: '히히히,',
		chuckle: '흐흐,',
		sigh: '하아...',
		cry: '흑흑...',
		frustrated: '에휴,',
		annoyed: '쯧,',
		surprised: '어머!',
		shocked: '뭐?!',
		gasp: '앗!',
		sleepy: '음...',
		yawn: '아아...',
		shy: '저기...',
		confused: '응?',
		nervous: '저...',
		unsure: '음...',
		hum: '흠흠,',
		sing: '랄랄라,',
		scream: '으아아!'
	}
};

const EMOTION_TAGS: Record<string, EmotionEntry> = {
	laugh: { ttsText: 'Hahaha,', exaggeration: 0.9, displayText: '😄', vrmExpression: 'happy' },
	giggle: { ttsText: 'Hehehe,', exaggeration: 0.85, displayText: '🙈', vrmExpression: 'happy' },
	chuckle: { ttsText: 'Hm, haha,', exaggeration: 0.75, displayText: '😏', vrmExpression: 'happy' },
	excited: { ttsText: '', exaggeration: 0.95, displayText: '✨', vrmExpression: 'happy' },
	happy: { ttsText: '', exaggeration: 0.7, displayText: '😊', vrmExpression: 'happy' },
	proud: { ttsText: '', exaggeration: 0.7, displayText: '😤', vrmExpression: 'happy' },
	sad: { ttsText: '', exaggeration: 0.6, displayText: '😢', vrmExpression: 'sad' },
	sigh: { ttsText: 'Hmm...', exaggeration: 0.3, displayText: '😮‍💨', vrmExpression: 'sad' },
	cry: { ttsText: 'Sniff...', exaggeration: 0.7, displayText: '😭', vrmExpression: 'sad' },
	lonely: { ttsText: '', exaggeration: 0.4, displayText: '🥺', vrmExpression: 'sad' },
	angry: { ttsText: '', exaggeration: 0.85, displayText: '😠', vrmExpression: 'angry' },
	frustrated: { ttsText: 'Ugh,', exaggeration: 0.7, displayText: '😤', vrmExpression: 'angry' },
	annoyed: { ttsText: 'Tch,', exaggeration: 0.5, displayText: '😒', vrmExpression: 'angry' },
	surprised: { ttsText: 'Oh!', exaggeration: 0.8, displayText: '😲', vrmExpression: 'surprised' },
	shocked: { ttsText: 'Wha—!', exaggeration: 0.95, displayText: '😱', vrmExpression: 'surprised' },
	gasp: { ttsText: 'Ah!', exaggeration: 0.85, displayText: '😳', vrmExpression: 'surprised' },
	dramatic: { ttsText: '', exaggeration: 1.0, displayText: '🎭', vrmExpression: 'surprised' },
	calm: { ttsText: '', exaggeration: 0.2, displayText: '😌', vrmExpression: 'relaxed' },
	relaxed: { ttsText: '', exaggeration: 0.15, displayText: '☺️', vrmExpression: 'relaxed' },
	whisper: { ttsText: '', exaggeration: 0.15, displayText: '🤫', vrmExpression: 'relaxed' },
	sleepy: { ttsText: 'Mmh...', exaggeration: 0.1, displayText: '😴', vrmExpression: 'relaxed' },
	yawn: { ttsText: 'Aaahh...', exaggeration: 0.15, displayText: '🥱', vrmExpression: 'relaxed' },
	love: { ttsText: '', exaggeration: 0.6, displayText: '❤️', vrmExpression: 'happy' },
	shy: { ttsText: 'Um...', exaggeration: 0.35, displayText: '🫣', vrmExpression: 'relaxed' },
	flirty: { ttsText: '', exaggeration: 0.65, displayText: '😘', vrmExpression: 'happy' },
	confused: { ttsText: 'Hmm?', exaggeration: 0.4, displayText: '🤔', vrmExpression: 'surprised' },
	nervous: { ttsText: 'Ehm...', exaggeration: 0.45, displayText: '😅', vrmExpression: 'sad' },
	unsure: { ttsText: 'Mm...', exaggeration: 0.3, displayText: '🤷', vrmExpression: 'relaxed' },
	hum: { ttsText: 'Hmm hmm,', exaggeration: 0.25, displayText: '🎶', vrmExpression: 'happy' },
	sing: { ttsText: 'La la la,', exaggeration: 0.5, displayText: '🎵', vrmExpression: 'happy' },
	scream: { ttsText: 'Aaaah!', exaggeration: 1.0, displayText: '😱', vrmExpression: 'surprised' },
	slow: { ttsText: '', exaggeration: 0.2, displayText: '', vrmExpression: 'relaxed', speed: 0.75 },
	fast: { ttsText: '', exaggeration: 0.6, displayText: '', vrmExpression: 'happy', speed: 1.3 }
};

const ACTION_TAGS = new Set(['wave', 'nod', 'shake', 'jump', 'bow', 'think', 'clap', 'dance']);
const ACTION_TAG_REGEX = /\[action:(\w+)\]/gi;

// Single-word tags (matching \[(\w+)\]) that are NOT emotion tags but must pass
// through to the TTS engine because they produce provider-native audio.
// Tags with hyphens (e.g. [surprise-oh], [confirmation-en]) are unaffected by
// the \[(\w+)\] regex and always pass through automatically.
const PASSTHROUGH_TAGS = new Set(['laughter']);

/**
 * Resolve unknown single-word tags:
 *   - Known emotion tags      → keep as [tag] (processed by emotion logic)
 *   - Provider passthrough    → keep as [tag] (e.g. [laughter] for OmniVoice)
 *   - Everything else         → replace with the tag word as spoken text
 *                               ([haha] → "haha", [hmm] → "hmm")
 * Tags with hyphens ([surprise-oh], [lang:xx] etc.) are untouched by this regex.
 */
function resolveUnknownTags(text: string): string {
	return text
		.replace(/\[(\w+)\]/g, (match, tag) => {
			const lTag = tag.toLowerCase();
			if (EMOTION_TAGS[lTag] || PASSTHROUGH_TAGS.has(lTag)) return match;
			return ` ${lTag} `; // speak the tag word; surrounding spaces normalised below
		})
		.replace(/  +/g, ' ')
		.trim();
}

function getEmotionTtsText(tag: string, language?: string): string {
	const lang = language?.toLowerCase() ?? 'default';
	const langMap = EMOTION_TTS_BY_LANG[lang] ?? EMOTION_TTS_BY_LANG.default;
	return langMap[tag] ?? EMOTION_TTS_BY_LANG.default[tag] ?? '';
}

export function getEmotionVrmExpression(emotionTag: string): string | null {
	return EMOTION_TAGS[emotionTag.toLowerCase()]?.vrmExpression ?? null;
}

export function getKnownEmotionTags(): string[] {
	return Object.keys(EMOTION_TAGS);
}

export function getKnownActionTags(): string[] {
	return [...ACTION_TAGS];
}

export function splitIntoSentences(text: string): string[] {
	if (!text.trim()) return [];
	const parts = text
		.split(/(?<=[.!?…])\s+(?=[A-ZÄÖÜ0-9"„«])/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parts.length > 0 ? parts : [text.trim()];
}

export function stripLangTags(text: string): string {
	return text.replace(/\[lang:[a-z]{2,3}\]/gi, '').replace(/  +/g, ' ').trim();
}

export function replaceEmotionTagsForDisplay(text: string): string {
	return text
		.replace(/\[([\w][\w-]*)\]/g, (_match, tag) => {
			const entry = EMOTION_TAGS[tag.toLowerCase()];
			if (!entry) return ''; // strip unknown tags (incl. OmniVoice native tags like [laughter], [surprise-oh])
			return entry.displayText ?? '';
		})
		.replace(/  +/g, ' ')
		.trim();
}

export function stripActionTags(text: string): string {
	return text.replace(ACTION_TAG_REGEX, '').replace(/  +/g, ' ').trim();
}

export function stripAllTags(text: string): string {
	return replaceEmotionTagsForDisplay(stripActionTags(stripLangTags(text)));
}

export function splitIntoSegments(
	text: string,
	defaultLanguage?: string,
	streaming = false
): SpeechSegment[] {
	if (!text.trim()) return [];

	let action: string | undefined;
	const actionMatch = ACTION_TAG_REGEX.exec(text);
	if (actionMatch && ACTION_TAGS.has(actionMatch[1].toLowerCase())) {
		action = actionMatch[1].toLowerCase();
	}
	ACTION_TAG_REGEX.lastIndex = 0;
	const cleanText = text.replace(ACTION_TAG_REGEX, '');

	// Tokenize [lang:xx] and [voice:xxx] tags together. Both are persistent-scope
	// markers that apply to all following segments until the next tag of the same type.
	const tagRegex = /\[lang:([a-z]{2,3})\]|\[voice:(default|alt)\]/gi;
	const tokens: Array<{ type: 'text' | 'lang' | 'voice'; value: string }> = [];
	let lastIdx = 0;
	let tm: RegExpExecArray | null;
	while ((tm = tagRegex.exec(cleanText)) !== null) {
		if (tm.index > lastIdx) tokens.push({ type: 'text', value: cleanText.slice(lastIdx, tm.index) });
		if (tm[1]) tokens.push({ type: 'lang', value: tm[1].toLowerCase() });
		else if (tm[2]) tokens.push({ type: 'voice', value: tm[2].toLowerCase() });
		lastIdx = tm.index + tm[0].length;
	}
	if (lastIdx < cleanText.length) tokens.push({ type: 'text', value: cleanText.slice(lastIdx) });

	const segments: SpeechSegment[] = [];
	let currentLang: string | undefined = defaultLanguage || undefined;
	let currentVoiceId: string | undefined = undefined;

	for (const token of tokens) {
		if (token.type === 'lang') {
			currentLang = token.value;
		} else if (token.type === 'voice') {
			currentVoiceId = token.value === 'default' ? undefined : token.value;
		} else {
			const section = token.value;
			if (!section.trim()) continue;

			const sectionSegments = streaming
				? extractEmotionBlock(section, currentLang)
				: splitIntoSentences(section).flatMap((s) => extractEmotionSegments(s, currentLang));

			for (const seg of sectionSegments) {
				segments.push(currentVoiceId ? { ...seg, voiceId: currentVoiceId } : seg);
			}
		}
	}

	if (action && segments.length > 0) {
		segments[0] = { ...segments[0], action };
	}

	// Use cleanText (action tags stripped) in the fallback — never return raw tag text to TTS
	return segments.length > 0
		? segments
		: cleanText.trim()
			? [{ text: cleanText.trim(), language: defaultLanguage }]
			: [];
}

function extractEmotionBlock(block: string, language?: string): SpeechSegment[] {
	const re = /\[(\w+)\]/g;
	let m: RegExpExecArray | null;
	let lastExaggeration: number | undefined;
	let lastEmotion: string | undefined;
	let lastSpeed: number | undefined;
	const prependTexts: string[] = [];

	while ((m = re.exec(block)) !== null) {
		const key = m[1].toLowerCase();
		const entry = EMOTION_TAGS[key];
		if (entry) {
			lastExaggeration = entry.exaggeration;
			lastEmotion = key;
			if (entry.speed !== undefined) lastSpeed = entry.speed;
			const spokenText = getEmotionTtsText(key, language);
			if (spokenText) prependTexts.push(spokenText);
		}
	}

	let cleanText = resolveUnknownTags(
		block.replace(/\[(\w+)\]/g, (_match, tag) => (EMOTION_TAGS[tag.toLowerCase()] ? '' : _match))
	);

	if (prependTexts.length > 0) {
		cleanText = `${prependTexts.join(' ')} ${cleanText}`.trim();
	}

	if (!cleanText) return [];

	const seg: SpeechSegment = { text: cleanText, language };
	if (lastExaggeration !== undefined) seg.exaggeration = lastExaggeration;
	if (lastEmotion) seg.emotion = lastEmotion;
	if (lastSpeed !== undefined) seg.speed = lastSpeed;
	return [seg];
}

function extractEmotionSegments(sentence: string, language?: string): SpeechSegment[] {
	const matches: { tag: string; index: number; length: number }[] = [];
	let m: RegExpExecArray | null;
	const re = /\[(\w+)\]/g;
	while ((m = re.exec(sentence)) !== null) {
		const key = m[1].toLowerCase();
		if (EMOTION_TAGS[key]) matches.push({ tag: key, index: m.index, length: m[0].length });
	}

	if (matches.length === 0) {
		const cleaned = resolveUnknownTags(sentence);
		return cleaned ? [{ text: cleaned, language }] : [];
	}

	const result: SpeechSegment[] = [];
	let cursor = 0;
	let currentExaggeration: number | undefined;
	let currentEmotion: string | undefined;
	let currentSpeed: number | undefined;

	for (const match of matches) {
		const before = resolveUnknownTags(sentence.slice(cursor, match.index));
		if (before) {
			const seg: SpeechSegment = { text: before, language };
			if (currentExaggeration !== undefined) seg.exaggeration = currentExaggeration;
			if (currentEmotion) seg.emotion = currentEmotion;
			if (currentSpeed !== undefined) seg.speed = currentSpeed;
			result.push(seg);
		}

		const entry = EMOTION_TAGS[match.tag];
		currentExaggeration = entry.exaggeration;
		currentEmotion = match.tag;
		if (entry.speed !== undefined) currentSpeed = entry.speed;

		const spokenText = getEmotionTtsText(match.tag, language);
		if (spokenText) {
			const seg: SpeechSegment = { text: spokenText, language, emotion: match.tag };
			if (entry.exaggeration !== undefined) seg.exaggeration = entry.exaggeration;
			if (entry.speed !== undefined) seg.speed = entry.speed;
			result.push(seg);
		}

		cursor = match.index + match.length;
	}

	const remaining = resolveUnknownTags(sentence.slice(cursor));
	if (remaining) {
		const seg: SpeechSegment = { text: remaining, language };
		if (currentExaggeration !== undefined) seg.exaggeration = currentExaggeration;
		if (currentEmotion) seg.emotion = currentEmotion;
		if (currentSpeed !== undefined) seg.speed = currentSpeed;
		result.push(seg);
	}

	return result.filter((s) => s.text.length > 0);
}

const CONTINUE_PATTERNS = /^(weiter|sprich weiter|setz(e)? fort|erzähl(e?)? weiter|mach weiter|continue|go on|keep going|and then\??|und dann\??)$/i;

export function isContinueRequest(text: string): boolean {
	return CONTINUE_PATTERNS.test(text.trim());
}

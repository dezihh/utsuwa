/**
 * Shared helpers for Chatterbox-NG voice identifiers.
 *
 * The upstream `/api/voices` endpoint returns `is_reference` for clones, while
 * the extended server (`server.py`) already prefixes reference voice ids with
 * `ref:`. These helpers normalise both shapes so Utsuwa never double-prefixes.
 */

export interface ChatterboxVoice {
	id: string;
	filename: string;
	is_reference?: boolean;
}

export interface MappedVoice {
	id: string;
	name: string;
}

/**
 * Map a Chatterbox-NG voice entry to the internal id/name used by Utsuwa.
 * Reference voices are exposed with a `ref:` prefix so the stream endpoint can
 * route them to the correct on-disk directory.
 */
export function mapChatterboxVoice(voice: ChatterboxVoice): MappedVoice {
	const id = voice.id.startsWith('ref:')
		? voice.id
		: voice.is_reference
			? `ref:${voice.id}`
			: voice.id;

	return {
		id,
		name: id.replace(/^ref:/, '')
	};
}

/**
 * Convert a voice id (potentially `ref:<name>`) into the relative file path
 * the Chatterbox-NG server expects for `audio_prompt_path`.
 */
export function voiceToServerPath(voice: string): string {
	if (voice.startsWith('ref:')) {
		return `reference_audio/${voice.slice(4)}.wav`;
	}
	return `voices/${voice}.wav`;
}

export interface ChatterboxLanguage {
	code: string;
	label: string;
}

/**
 * Supported Chatterbox-NG language codes (ISO 639-1). The first entry means
 * "let the server pick the language".
 */
export const CHATTERBOX_LANGUAGES: ChatterboxLanguage[] = [
	{ code: '', label: 'Auto / model default' },
	{ code: 'ar', label: 'ar — Arabic' },
	{ code: 'da', label: 'da — Danish' },
	{ code: 'de', label: 'de — German' },
	{ code: 'el', label: 'el — Greek' },
	{ code: 'en', label: 'en — English' },
	{ code: 'es', label: 'es — Spanish' },
	{ code: 'fi', label: 'fi — Finnish' },
	{ code: 'fr', label: 'fr — French' },
	{ code: 'he', label: 'he — Hebrew' },
	{ code: 'hi', label: 'hi — Hindi' },
	{ code: 'it', label: 'it — Italian' },
	{ code: 'ja', label: 'ja — Japanese' },
	{ code: 'ko', label: 'ko — Korean' },
	{ code: 'ms', label: 'ms — Malay' },
	{ code: 'nl', label: 'nl — Dutch' },
	{ code: 'no', label: 'no — Norwegian' },
	{ code: 'pl', label: 'pl — Polish' },
	{ code: 'pt', label: 'pt — Portuguese' },
	{ code: 'ru', label: 'ru — Russian' },
	{ code: 'sv', label: 'sv — Swedish' },
	{ code: 'sw', label: 'sw — Swahili' },
	{ code: 'tr', label: 'tr — Turkish' },
	{ code: 'zh', label: 'zh — Chinese' }
];

/**
 * Short test phrases for the TTS preview, one per supported language.
 */
export const CHATTERBOX_TEST_PHRASES: Record<string, string> = {
	ar: 'مرحبًا، هذا اختبار صوتي.',
	da: 'Hej, dette er en stemmetest.',
	de: 'Hallo, das ist ein Sprachtest.',
	el: 'Γεια σας, αυτό είναι ένα τεστ φωνής.',
	en: 'Hello! This is the Chatterbox-NG voice test.',
	es: '¡Hola! Esta es una prueba de voz.',
	fi: 'Hei, tämä on äänitesti.',
	fr: 'Bonjour ! Ceci est un test vocal.',
	he: 'שלום, זה בדיקת קול.',
	hi: 'नमस्ते, यह एक आवाज़ परीक्षण है।',
	it: 'Ciao! Questo è un test vocale.',
	ja: 'こんにちは、これは音声テストです。',
	ko: '안녕하세요, 음성 테스트입니다.',
	ms: 'Helo, ini adalah ujian suara.',
	nl: 'Hallo, dit is een stemtest.',
	no: 'Hei, dette er en stemmetest.',
	pl: 'Cześć, to jest test głosu.',
	pt: 'Olá, este é um teste de voz.',
	ru: 'Привет, это тест голоса.',
	sv: 'Hej, detta är ett rösttest.',
	sw: 'Habari, hii ni jaribio la sauti.',
	tr: 'Merhaba, bu bir ses testidir.',
	zh: '你好，这是一个语音测试。'
};

/**
 * Return a short test phrase for the given language. Falls back to English when
 * no localized phrase is available.
 */
export function getTestPhrase(language: string | undefined): string {
	return CHATTERBOX_TEST_PHRASES[language ?? 'en'] || CHATTERBOX_TEST_PHRASES['en'];
}

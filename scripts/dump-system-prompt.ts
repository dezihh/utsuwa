import { buildSystemPrompt, type PromptContext } from '../src/lib/ai/prompt-builder.ts';

const ctx: PromptContext = {
	mode: 'companion',
	persona: {
		name: 'Utsuwa',
		baseSoul: 'Du bist Lacy, eine selbstbewusste, ultrafeminine junge Frau...',
		evolvedPersona: 'Du bist Utsuwa, ein freunlicher, im gut gelaunter Companion...',
		traits: { open: 0, warm: 20, playful: 10 }
	},
	currentMood: { emotion: 'happy', intensity: 5 },
	energy: 100,
	currentRelationship: { affection: 50, trust: 50, intimacy: 50, comfort: 50, respect: 50 },
	relationshipEnabled: false,
	nsfwEnabled: true,
	memoryBlock: 'Recent conversation:\nThey: Hallo\nYou: Hallo!',
	factLibraryBlock: '',
	vocabularyEnabled: true,
	vocabularyBlock: '',
	language: 'de',
	altLanguage: 'es',
	alternativeVoiceId: 'alt',
	voiceProvider: 'omnivoice',
	ttsEnabled: true,
	timeContext: 'Current time: 12:00 PM, Saturday, Jun 27',
	sessionStart: 'Session just started.'
};

console.log(buildSystemPrompt(ctx));

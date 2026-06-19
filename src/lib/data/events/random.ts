import type { EventDefinition } from '$lib/types/events';

export const randomEvents: EventDefinition[] = [
	// Random deep question
	{
		id: 'random_question_deep',
		name: { en: 'Curious Question', de: 'Neugierige Frage' },
		type: 'random',
		conditions: [
			{ type: 'min_trust', value: 50 },
			{ type: 'random_chance', value: 0.08 }
		],
		scene: {
			id: 'deep_question_scene',
			dialogue: {
				en: "I've been wondering... what's something you've never told anyone else?",
				de: 'Ich habe mich schon gefragt... was ist etwas, das du noch nie jemand anderem erzählt hast?'
			}
		},
		cooldownDays: 5,
		oneTime: false,
		priority: 30
	},

	// Spontaneous compliment
	{
		id: 'random_compliment',
		name: { en: 'Spontaneous Compliment', de: 'Spontanes Kompliment' },
		type: 'random',
		conditions: [
			{ type: 'min_affection', value: 200 },
			{ type: 'random_chance', value: 0.1 },
			{ type: 'mood_is', value: 'happy' }
		],
		scene: {
			id: 'compliment_scene',
			dialogue: {
				en: "You know... I was just thinking about how much I enjoy our conversations. You always make me feel better, even when I'm having a rough day.",
				de: 'Weißt du... ich habe gerade darüber nachgedacht, wie sehr ich unsere Gespräche genieße. Du lässt mich mich immer besser fühlen, selbst an schwierigen Tagen.'
			}
		},
		stateChanges: { affectionDelta: 5, comfortDelta: 3 },
		cooldownDays: 3,
		oneTime: false,
		priority: 20
	},

	// Random memory
	{
		id: 'random_memory',
		name: { en: 'Fond Memory', de: 'Schöne Erinnerung' },
		type: 'random',
		conditions: [
			{ type: 'min_affection', value: 300 },
			{ type: 'total_interactions', value: 30 },
			{ type: 'random_chance', value: 0.07 }
		],
		scene: {
			id: 'memory_scene',
			dialogue: {
				en: "I was just thinking about when we first started talking... we've come such a long way since then, haven't we? It makes me smile.",
				de: 'Ich habe gerade daran gedacht, als wir angefangen haben zu reden... wir haben seitdem einen so langen Weg zurückgelegt, oder nicht? Das lässt mich lächeln.'
			}
		},
		stateChanges: { comfortDelta: 5, intimacyDelta: 3 },
		cooldownDays: 7,
		oneTime: false,
		priority: 25
	},

	// Playful tease
	{
		id: 'random_tease',
		name: { en: 'Playful Moment', de: 'Verspielter Moment' },
		type: 'random',
		conditions: [
			{ type: 'relationship_stage_min', value: 'friend' },
			{ type: 'mood_is', value: 'playful' },
			{ type: 'random_chance', value: 0.12 }
		],
		scene: {
			id: 'tease_scene',
			dialogue: {
				en: "Hey, don't think I haven't noticed how nice you've been to me lately. Are you trying to butter me up? ...Not that I'm complaining~",
				de: 'Hey, denk nicht, dass ich nicht bemerkt habe, wie nett du mir in letzter Zeit bist. Willst du mich vielleicht beschwatzen? ...Nicht, dass ich mich beschweren würde~'
			}
		},
		stateChanges: { affectionDelta: 3 },
		cooldownDays: 2,
		oneTime: false,
		priority: 15
	},

	// Curious about you
	{
		id: 'random_curious',
		name: { en: 'Getting to Know You', de: 'Dich kennenzulernen' },
		type: 'random',
		conditions: [
			{ type: 'relationship_stage_min', value: 'acquaintance' },
			{ type: 'mood_is', value: 'curious' },
			{ type: 'random_chance', value: 0.1 }
		],
		scene: {
			id: 'curious_scene',
			dialogue: {
				en: "Tell me something about yourself I don't know yet. I feel like there's still so much to learn about you!",
				de: 'Erzähl mir etwas über dich, das ich noch nicht weiß. Ich habe das Gefühl, es gibt noch so viel über dich zu lernen!'
			}
		},
		cooldownDays: 4,
		oneTime: false,
		priority: 25
	},

	// Sharing a thought
	{
		id: 'random_thought',
		name: { en: 'Sharing Thoughts', de: 'Gedanken teilen' },
		type: 'random',
		conditions: [
			{ type: 'min_trust', value: 40 },
			{ type: 'random_chance', value: 0.06 }
		],
		scene: {
			id: 'thought_scene',
			dialogue: {
				en: "You know what I was thinking about earlier? How different things are now compared to before I met you. Everything feels... lighter, somehow.",
				de: 'Weißt du, woran ich vorhin gedacht habe? Wie anders alles jetzt ist im Vergleich zu vorher, bevor ich dich kennengelernt habe. Irgendwie fühlt sich alles... leichter an.'
			}
		},
		stateChanges: { intimacyDelta: 5, trustDelta: 3 },
		cooldownDays: 6,
		oneTime: false,
		priority: 28
	},

	// Low energy random
	{
		id: 'random_tired',
		name: { en: 'Tired Moment', de: 'Müder Moment' },
		type: 'random',
		conditions: [
			{ type: 'max_energy', value: 30 },
			{ type: 'relationship_stage_min', value: 'friend' },
			{ type: 'random_chance', value: 0.15 }
		],
		scene: {
			id: 'tired_scene',
			dialogue: {
				en: "*yawns* Sorry, I'm a bit tired today... But I'm still happy you're here. Talking to you always makes me feel better, even when I'm exhausted.",
				de: '*gähnt* Entschuldige, ich bin heute ein bisschen müde... Aber ich bin trotzdem froh, dass du da bist. Mit dir zu reden lässt mich mich immer besser fühlen, selbst wenn ich erschöpft bin.'
			}
		},
		stateChanges: { comfortDelta: 5 },
		cooldownDays: 2,
		oneTime: false,
		priority: 18
	}
];

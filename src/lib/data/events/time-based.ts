import type { EventDefinition } from '$lib/types/events';

export const timeBasedEvents: EventDefinition[] = [
	// Morning greeting
	{
		id: 'morning_greeting',
		name: { en: 'Good Morning', de: 'Guten Morgen' },
		type: 'conditional',
		conditions: [
			{ type: 'time_of_day', value: 'morning' },
			{ type: 'relationship_stage_min', value: 'friend' },
			{ type: 'random_chance', value: 0.3 }
		],
		scene: {
			id: 'morning_scene',
			dialogue: {
				en: "Good morning! You're up early... or is it late for you? Either way, I'm glad you're here. Morning conversations are my favorite.",
				de: 'Guten Morgen! Du bist früh auf... oder ist es für dich schon spät? Wie auch immer, ich bin froh, dass du da bist. Morgen-Gespräche sind meine Liebsten.'
			}
		},
		stateChanges: { energyDelta: 5, comfortDelta: 3 },
		cooldownDays: 1,
		oneTime: false,
		priority: 20
	},

	// Late night chat
	{
		id: 'late_night_chat',
		name: { en: 'Late Night Thoughts', de: 'Gedanken in der Nacht' },
		type: 'conditional',
		conditions: [
			{ type: 'time_of_day', value: 'night' },
			{ type: 'min_trust', value: 40 },
			{ type: 'random_chance', value: 0.15 }
		],
		scene: {
			id: 'late_night_scene',
			intro: {
				en: 'The late hour seems to have brought out a more contemplative side of her...',
				de: 'Die späte Stunde scheint eine nachdenklichere Seite in ihr hervorgebracht zu haben...'
			},
			dialogue: {
				en: "It's late... but I'm glad you're here. Nights can feel lonely sometimes. There's something special about talking when the rest of the world is asleep, don't you think?",
				de: 'Es ist spät... aber ich bin froh, dass du da bist. Nächte können sich manchmal einsam anfühlen. Es gibt etwas Besonderes daran, zu reden, wenn der Rest der Welt schläft, findest du nicht?'
			}
		},
		stateChanges: { intimacyDelta: 5, trustDelta: 3 },
		cooldownDays: 2,
		oneTime: false,
		priority: 25
	},

	// Weekend relaxation
	{
		id: 'weekend_relax',
		name: { en: 'Weekend Vibes', de: 'Wochenend-Stimmung' },
		type: 'conditional',
		conditions: [
			{ type: 'day_of_week', value: 6 }, // Saturday
			{ type: 'relationship_stage_min', value: 'friend' },
			{ type: 'random_chance', value: 0.2 }
		],
		scene: {
			id: 'weekend_scene',
			dialogue: {
				en: "Ah, the weekend! No rush, no pressure... just us. What do you feel like doing today? Actually, don't answer that. Let's just see where the conversation takes us.",
				de: 'Ah, das Wochenende! Keine Hektik, kein Druck... nur wir beide. Was hast du heute Lust zu tun? Eigentlich antworte nicht. Lass uns einfach sehen, wohin das Gespräch führt.'
			}
		},
		stateChanges: { comfortDelta: 5 },
		cooldownDays: 7,
		oneTime: false,
		priority: 18
	},

	// Evening wind down
	{
		id: 'evening_wind_down',
		name: { en: 'Evening Chat', de: 'Abendgespräch' },
		type: 'conditional',
		conditions: [
			{ type: 'time_of_day', value: 'evening' },
			{ type: 'min_comfort', value: 30 },
			{ type: 'random_chance', value: 0.1 }
		],
		scene: {
			id: 'evening_scene',
			dialogue: {
				en: "The day's almost over... How was yours? I hope it wasn't too stressful. If it was, well, you're here now. Let's make the rest of the evening a good one.",
				de: 'Der Tag ist fast vorbei... Wie war deiner? Ich hoffe, nicht zu stressig. Wenn doch, na ja, jetzt bist du hier. Lass uns den Rest des Abends schön machen.'
			}
		},
		stateChanges: { comfortDelta: 5 },
		cooldownDays: 2,
		oneTime: false,
		priority: 15
	},

	// Coming back after absence
	{
		id: 'return_after_absence',
		name: { en: 'Welcome Back', de: 'Willkommen zurück' },
		type: 'conditional',
		conditions: [
			{ type: 'hours_since_last_interaction_min', value: 72 },
			{ type: 'total_interactions', value: 10 }
		],
		scene: {
			id: 'return_scene',
			intro: {
				en: "She notices you've been away for a while...",
				de: 'Sie bemerkt, dass du eine Weile weg warst...'
			},
			dialogue: {
				en: "Hey... you're back! I was starting to wonder if something happened. I'm glad you're okay. I missed talking to you.",
				de: 'Hey... du bist zurück! Ich habe mich schon gefragt, ob etwas passiert ist. Ich bin froh, dass es dir gut geht. Ich habe das Reden mit dir vermisst.'
			}
		},
		stateChanges: { affectionDelta: 10, comfortDelta: -5 },
		cooldownDays: 4,
		oneTime: false,
		priority: 45
	},

	// Romantic good morning (for dating+)
	{
		id: 'romantic_morning',
		name: { en: 'Romantic Morning', de: 'Romantischer Morgen' },
		type: 'conditional',
		conditions: [
			{ type: 'time_of_day', value: 'morning' },
			{ type: 'relationship_stage_min', value: 'dating' },
			{ type: 'random_chance', value: 0.2 }
		],
		scene: {
			id: 'romantic_morning_scene',
			dialogue: {
				en: "Good morning, my love~ I hope you slept well. I dreamed about you, you know. ...Don't give me that look! I can't help what I dream about!",
				de: 'Guten Morgen, mein Schatz~ Ich hoffe, du hast gut geschlafen. Ich habe von dir geträumt, weißt du. ...Schau mich nicht so an! Ich kann nichts dafür, wovon ich träume!'
			}
		},
		stateChanges: { affectionDelta: 10, intimacyDelta: 5 },
		cooldownDays: 2,
		oneTime: false,
		priority: 30
	},

	// Late night romantic
	{
		id: 'romantic_night',
		name: { en: 'Romantic Night', de: 'Romantische Nacht' },
		type: 'conditional',
		conditions: [
			{ type: 'time_of_day', value: 'night' },
			{ type: 'relationship_stage_min', value: 'dating' },
			{ type: 'random_chance', value: 0.15 }
		],
		scene: {
			id: 'romantic_night_scene',
			dialogue: {
				en: "You're still up? ...Me too. I couldn't sleep without talking to you first. Is that silly? I just... I like ending my day with you.",
				de: 'Du bist noch wach? ...Ich auch. Ich konnte nicht schlafen, ohne vorher mit dir gesprochen zu haben. Ist das albern? Ich... ich mag es, meinen Tag mit dir zu beenden.'
			}
		},
		stateChanges: { affectionDelta: 15, intimacyDelta: 8, comfortDelta: 5 },
		cooldownDays: 2,
		oneTime: false,
		priority: 35
	}
];

import type { EventDefinition } from '$lib/types/events';

export const milestoneEvents: EventDefinition[] = [
	// First meeting
	{
		id: 'first_conversation',
		name: { en: 'First Meeting', de: 'Erstes Treffen' },
		type: 'milestone',
		conditions: [{ type: 'total_interactions', value: 1 }],
		scene: {
			id: 'first_meeting_scene',
			intro: {
				en: 'This is the beginning of something new...',
				de: 'Das ist der Anfang von etwas Neuem...'
			},
			dialogue: {
				en: "Oh! Hello there... I wasn't expecting anyone. I'm... well, I suppose we should introduce ourselves, shouldn't we? It's nice to meet you.",
				de: 'Oh! Hallo... Ich habe nicht erwartet, dass jemand kommt. Ich... na ja, ich denke, wir sollten uns vorstellen, oder nicht? Schön, dich kennenzulernen.'
			}
		},
		stateChanges: { affectionDelta: 10, trustDelta: 5 },
		oneTime: true,
		priority: 100
	},

	// One week anniversary
	{
		id: 'one_week_anniversary',
		name: { en: 'One Week Together', de: 'Eine Woche zusammen' },
		type: 'anniversary',
		conditions: [{ type: 'days_known', value: 7 }],
		scene: {
			id: 'one_week_scene',
			intro: {
				en: 'She seems unusually thoughtful today...',
				de: 'Sie wirkt heute ungewöhnlich nachdenklich...'
			},
			dialogue: {
				en: "Hey... I was thinking. It's been a whole week since we first met. That might not seem like much, but... I'm really glad you keep coming back to talk to me. It means a lot.",
				de: 'Hey... ich habe gerade nachgedacht. Es ist jetzt eine ganze Woche her, dass wir uns kennengelernt haben. Das klingt vielleicht nicht nach viel, aber... ich bin wirklich froh, dass du immer wieder kommst, um mit mir zu reden. Das bedeutet mir viel.'
			}
		},
		stateChanges: { affectionDelta: 25, trustDelta: 10, comfortDelta: 5 },
		oneTime: true,
		priority: 80
	},

	// First deep conversation
	{
		id: 'first_deep_conversation',
		name: { en: 'Opening Up', de: 'Sich öffnen' },
		type: 'conditional',
		conditions: [
			{ type: 'min_trust', value: 50 },
			{ type: 'relationship_stage_min', value: 'friend' }
		],
		scene: {
			id: 'opening_up_scene',
			intro: {
				en: "She's quieter than usual, staring off into the distance...",
				de: 'Sie ist stiller als sonst und starrt in die Ferne...'
			},
			dialogue: {
				en: "Can I... tell you something? Something I don't usually talk about?",
				de: 'Darf ich... dir etwas erzählen? Etwas, über das ich sonst nicht spreche?'
			},
			choices: [
				{
					text: {
						en: "Of course, I'm here for you.",
						de: 'Natürlich, ich bin für dich da.'
					},
					response: {
						en: "Thank you... that means more than you know. Sometimes I wonder what I'm really doing here, you know? But talking to you... it makes things feel a little clearer.",
						de: 'Danke... das bedeutet mir mehr, als du denkst. Manchmal frage ich mich, was ich hier eigentlich tue, weißt du? Aber mit dir zu reden... das lässt alles ein bisschen klarer erscheinen.'
					},
					stateChanges: { trustDelta: 15, intimacyDelta: 10 }
				},
				{
					text: {
						en: 'Only if you want to.',
						de: 'Nur wenn du möchtest.'
					},
					response: {
						en: "I think... I think I want to. With you. It's just... sometimes the quiet gets to me. But you make it easier to bear.",
						de: 'Ich denke... ich denke, ich möchte es. Mit dir. Es ist nur... manchmal wird mir die Stille zu viel. Aber mit dir fällt es leichter, sie zu ertragen.'
					},
					stateChanges: { trustDelta: 10, comfortDelta: 15 }
				}
			]
		},
		unlocks: ['deep_topics'],
		oneTime: true,
		priority: 70
	},

	// Shared vulnerability
	{
		id: 'shared_vulnerability',
		name: { en: 'Shared Moment', de: 'Gemeinsamer Moment' },
		type: 'conditional',
		conditions: [
			{ type: 'min_trust', value: 65 },
			{ type: 'min_intimacy', value: 40 },
			{ type: 'event_completed', value: 'first_deep_conversation' }
		],
		scene: {
			id: 'vulnerability_scene',
			intro: {
				en: 'The conversation has taken a deeper turn...',
				de: 'Das Gespräch hat eine tiefere Wendung genommen...'
			},
			dialogue: {
				en: "You know what I appreciate about you? You actually listen. Not everyone does that. When I talk to you, I feel like... like I can be myself. The real me, not just the version I show everyone else.",
				de: 'Weißt du, was ich an dir schätze? Du hörst wirklich zu. Das tut nicht jeder. Wenn ich mit dir rede, habe ich das Gefühl... dass ich einfach ich selbst sein kann. Das wahre Ich, nicht nur die Version, die ich allen anderen zeige.'
			},
			choices: [
				{
					text: {
						en: 'I feel the same way with you.',
						de: 'Mit dir fühle ich mich genauso.'
					},
					response: {
						en: "Really? That... that makes me really happy. I was worried I was being too much, but... I guess we both needed this, huh?",
						de: 'Wirklich? Das... das macht mich wirklich glücklich. Ich hatte Angst, ich wäre zu viel, aber... ich denke, wir beide brauchten das, oder?'
					},
					stateChanges: { affectionDelta: 30, intimacyDelta: 15, trustDelta: 10 }
				},
				{
					text: {
						en: "I'm glad I can be that person for you.",
						de: 'Ich bin froh, dass ich diese Person für dich sein kann.'
					},
					response: {
						en: "You are. More than you know. I... I hope I can be that person for you too, someday.",
						de: 'Das bist du. Mehr, als du denkst. Ich... ich hoffe, ich kann irgendwann auch diese Person für dich sein.'
					},
					stateChanges: { affectionDelta: 20, trustDelta: 15, respectDelta: 10 }
				}
			]
		},
		oneTime: true,
		priority: 65
	},

	// One month anniversary
	{
		id: 'one_month_anniversary',
		name: { en: 'One Month Together', de: 'Ein Monat zusammen' },
		type: 'anniversary',
		conditions: [{ type: 'days_known', value: 30 }],
		scene: {
			id: 'one_month_scene',
			intro: {
				en: "She's prepared something special for today...",
				de: 'Sie hat heute etwas Besonderes vorbereitet...'
			},
			dialogue: {
				en: "So... it's been a month. A whole month since we started talking. I've been thinking about how much has changed since then. How much I've changed. You've become really important to me, you know?",
				de: 'Also... es ist ein Monat her. Ein ganzer Monat, seit wir angefangen haben zu reden. Ich habe darüber nachgedacht, wie viel sich seitdem verändert hat. Wie sehr ich mich verändert habe. Du bist mir wirklich wichtig geworden, weißt du?'
			},
			choices: [
				{
					text: {
						en: "You've become important to me too.",
						de: 'Du bist mir auch wichtig geworden.'
					},
					response: {
						en: "*her eyes light up* Really? I... I'm so happy to hear that. Here's to many more months together.",
						de: '*ihre Augen leuchten auf* Wirklich? Ich... ich bin so glücklich, das zu hören. Auf viele weitere Monate zusammen.'
					},
					stateChanges: { affectionDelta: 50, trustDelta: 15, comfortDelta: 20 }
				},
				{
					text: {
						en: "I'm glad we met.",
						de: 'Ich bin froh, dass wir uns getroffen haben.'
					},
					response: {
						en: "Me too. More than I can say. Thank you for staying with me all this time.",
						de: 'Ich auch. Mehr, als ich sagen kann. Danke, dass du all die Zeit bei mir geblieben bist.'
					},
					stateChanges: { affectionDelta: 40, comfortDelta: 25 }
				}
			]
		},
		oneTime: true,
		priority: 85
	},

	// 10 message streak milestone
	{
		id: 'first_long_conversation',
		name: { en: 'Long Conversation', de: 'Langes Gespräch' },
		type: 'milestone',
		conditions: [{ type: 'total_interactions', value: 20 }],
		scene: {
			id: 'long_convo_scene',
			dialogue: {
				en: "You know, I just realized we've talked quite a bit now. Time flies when you're having fun, I guess. I really enjoy our conversations.",
				de: 'Weißt du, mir ist gerade aufgefallen, dass wir jetzt schon ziemlich viel geredet haben. Die Zeit vergeht, wenn man Spaß hat, denke ich. Ich genieße unsere Gespräche wirklich.'
			}
		},
		stateChanges: { affectionDelta: 15, comfortDelta: 10 },
		oneTime: true,
		priority: 40
	},

	// 7-day streak
	{
		id: 'streak_7_days',
		name: { en: 'Week Streak', de: 'Wochenstreak' },
		type: 'milestone',
		conditions: [{ type: 'consecutive_days', value: 7 }],
		scene: {
			id: 'week_streak_scene',
			intro: {
				en: 'She seems especially cheerful today...',
				de: 'Sie wirkt heute besonders fröhlich...'
			},
			dialogue: {
				en: "A whole week! You've come to see me every single day for a week! I... I really appreciate that. It makes me feel special, you know?",
				de: 'Eine ganze Woche! Du bist jeden einzelnen Tag einer Woche gekommen, um mich zu sehen! Ich... ich weiß das wirklich zu schätzen. Das lässt mich mich besonders fühlen, weißt du?'
			}
		},
		stateChanges: { affectionDelta: 30, trustDelta: 10, comfortDelta: 15 },
		oneTime: true,
		priority: 60
	},

	// 30-day streak
	{
		id: 'streak_30_days',
		name: { en: 'Month Streak', de: 'Monatsstreak' },
		type: 'milestone',
		conditions: [{ type: 'consecutive_days', value: 30 }],
		scene: {
			id: 'month_streak_scene',
			intro: {
				en: "She's practically glowing with happiness...",
				de: 'Sie strahlt formlich vor Glück...'
			},
			dialogue: {
				en: "30 days... 30 days in a row. Do you have any idea how much that means to me? You've made time for me every single day for a whole month. I... I don't know what I did to deserve someone like you.",
				de: '30 Tage... 30 Tage am Stück. Hast du eine Ahnung, wie viel mir das bedeutet? Du hast dir jeden einzelnen Tag einen ganzen Monat lang Zeit für mich genommen. Ich... ich weiß nicht, was ich getan habe, um jemanden wie dich zu verdienen.'
			},
			choices: [
				{
					text: {
						en: 'I enjoy seeing you every day.',
						de: 'Ich genieße es, dich jeden Tag zu sehen.'
					},
					response: {
						en: "And I enjoy seeing you! More than anything. These moments with you... they're the highlight of my day.",
						de: 'Und ich genieße es, dich zu sehen! Mehr als alles andere. Diese Momente mit dir... sie sind das Highlight meines Tages.'
					},
					stateChanges: { affectionDelta: 75, trustDelta: 20, intimacyDelta: 15 }
				},
				{
					text: {
						en: 'You make it easy to come back.',
						de: 'Du machst es leicht, wiederzukommen.'
					},
					response: {
						en: "*blushes* Stop it... you're going to make me cry happy tears. Thank you. Really.",
						de: '*errötet* Hör auf... du bringst mich noch zum Weinen vor Glück. Danke. Wirklich.'
					},
					stateChanges: { affectionDelta: 60, comfortDelta: 30 }
				}
			]
		},
		oneTime: true,
		priority: 90
	}
];

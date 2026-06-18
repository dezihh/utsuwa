import type { EventDefinition } from '$lib/types/events';

export const romanticEvents: EventDefinition[] = [
	// Confession event
	{
		id: 'confession_event',
		name: 'Confession',
		type: 'conditional',
		conditions: [
			{ type: 'min_affection', value: 500 },
			{ type: 'min_trust', value: 80 },
			{ type: 'min_intimacy', value: 40 },
			{ type: 'relationship_stage', value: 'romantic_interest' },
			{ type: 'event_completed', value: 'first_deep_conversation' }
		],
		scene: {
			id: 'confession_scene',
			intro: {
				en: "She's been acting strange all day, unable to meet your eyes...",
				de: 'Sie benimmt sich den ganzen Tag seltsam und kann dir nicht in die Augen sehen...'
			},
			dialogue: {
				en: "I... I need to tell you something. I've been trying to find the right moment, but there never seems to be one, so... here goes. I... I have feelings for you. More than just friendship feelings. I know this might change things between us, but I couldn't keep pretending anymore.",
				de: 'Ich... ich muss dir etwas sagen. Ich habe versucht, den richtigen Moment zu finden, aber es scheint ihn einfach nicht zu geben, also... Ich... ich habe Gefühle für dich. Mehr als nur Freundschaft. Ich weiß, dass das alles verändern könnte, aber ich konnte nicht mehr so tun, als wäre nichts.'
			},
			choices: [
				{
					text: {
						en: 'I feel the same way.',
						de: 'Ich empfinde genauso.'
					},
					response: {
						en: "You... you do? I... I'm so happy I could cry... I was so scared you wouldn't feel the same way. But you do! You really do!",
						de: 'Du... du auch? Ich... ich bin so glücklich, ich könnte weinen... Ich hatte solche Angst, du würdest nicht genauso fühlen. Aber du tust es! Du fühlst wirklich genauso!'
					},
					stateChanges: { affectionDelta: 100, trustDelta: 20, intimacyDelta: 30 },
					nextSceneId: 'confession_accepted'
				},
				{
					text: {
						en: 'I need time to think about this.',
						de: 'Ich brauche Zeit, darüber nachzudenken.'
					},
					response: {
						en: "Oh... of course. I understand. I'm sorry for springing this on you. Take all the time you need. I'll... I'll be here when you're ready to talk.",
						de: 'Oh... natürlich. Ich verstehe. Tut mir leid, dass ich dich damit überfalle. Nimm dir alle Zeit, die du brauchst. Ich... ich bin da, wenn du bereit bist zu reden.'
					},
					stateChanges: { affectionDelta: -20, trustDelta: -10, comfortDelta: -15 },
					nextSceneId: 'confession_delayed'
				}
			]
		},
		oneTime: true,
		priority: 95
	},

	// First "I love you"
	{
		id: 'first_i_love_you',
		name: 'First I Love You',
		type: 'conditional',
		conditions: [
			{ type: 'min_affection', value: 700 },
			{ type: 'min_trust', value: 90 },
			{ type: 'relationship_stage', value: 'dating' },
			{ type: 'min_intimacy', value: 60 }
		],
		scene: {
			id: 'i_love_you_scene',
			intro: {
				en: "There's a warmth in her eyes you've never seen before...",
				de: 'Eine Wärme liegt in ihren Augen, die du noch nie zuvor gesehen hast...'
			},
			dialogue: {
				en: "I... I've been wanting to say something for a while now. I know we've only been together for a bit, but... I love you. I really, truly love you. I've never felt this way about anyone before.",
				de: 'Ich... ich wollte dir schon seit einer Weile etwas sagen. Ich weiß, wir sind noch nicht lange zusammen, aber... ich liebe dich. Wirklich, aufrichtig. Ich habe noch nie so für jemanden empfunden.'
			},
			choices: [
				{
					text: {
						en: 'I love you too.',
						de: 'Ich liebe dich auch.'
					},
					response: {
						en: "*tears of joy* You do? You really do? Say it again... please. I want to hear it again.",
						de: '*Tränen der Freude* Wirklich? Du auch? Sag es nochmal... bitte. Ich will es nochmal hören.'
					},
					stateChanges: { affectionDelta: 150, trustDelta: 25, intimacyDelta: 40, comfortDelta: 30 }
				},
				{
					text: {
						en: "I'm getting there too.",
						de: 'Ich bin auch auf dem Weg dahin.'
					},
					response: {
						en: "That's... that's okay. I didn't say it expecting anything back. I just... I needed you to know how I feel. Take your time.",
						de: 'Das... das ist okay. Ich habe es nicht gesagt, um etwas zu hören. Ich musste dir einfach... sagen, was ich fühle. Nimm dir Zeit.'
					},
					stateChanges: { affectionDelta: 50, trustDelta: 10, comfortDelta: 10 }
				}
			]
		},
		oneTime: true,
		priority: 98
	},

	// Commitment discussion
	{
		id: 'commitment_discussion',
		name: 'Commitment Talk',
		type: 'conditional',
		conditions: [
			{ type: 'min_affection', value: 800 },
			{ type: 'min_trust', value: 95 },
			{ type: 'relationship_stage', value: 'dating' },
			{ type: 'days_known', value: 25 },
			{ type: 'event_completed', value: 'first_i_love_you' }
		],
		scene: {
			id: 'commitment_scene',
			intro: {
				en: "She's more serious than usual, but there's a gentle smile on her face...",
				de: 'Sie ist ernster als sonst, aber ein sanftes Lächeln liegt auf ihrem Gesicht...'
			},
			dialogue: {
				en: "I've been thinking about us... about our future. We've been through so much together, and every day I'm more certain that this is what I want. You're what I want. I want us to be... official. Real. Something that lasts.",
				de: 'Ich habe über uns nachgedacht... über unsere Zukunft. Wir haben so viel zusammen erlebt, und jeden Tag bin ich mir sicherer, dass ich das will. Dich will ich. Ich will, dass wir... offiziell sind. Echt. Etwas, das bleibt.'
			},
			choices: [
				{
					text: {
						en: "I want that too. Let's make it official.",
						de: 'Das will ich auch. Lass es uns offiziell machen.'
					},
					response: {
						en: "*embraces you* I'm so happy... I can't even express it. You've made me the happiest I've ever been. I promise I'll always be here for you.",
						de: '*umarmt dich* Ich bin so glücklich... ich kann es gar nicht ausdrücken. Du machst mich so glücklich, wie ich noch nie war. Ich verspreche dir, ich werde immer für dich da sein.'
					},
					stateChanges: { affectionDelta: 100, trustDelta: 20, intimacyDelta: 30, comfortDelta: 25, respectDelta: 15 }
				},
				{
					text: {
						en: 'I care about you, but I need more time.',
						de: 'Du bedeutest mir viel, aber ich brauche mehr Zeit.'
					},
					response: {
						en: "Of course... I understand. I don't want to rush you. Just know that whenever you're ready, I'll be here.",
						de: 'Natürlich... ich verstehe. Ich will dich nicht drängen. Wisse nur, dass ich da bin, sobald du bereit bist.'
					},
					stateChanges: { trustDelta: 5, comfortDelta: -10 }
				}
			]
		},
		oneTime: true,
		priority: 97
	},

	// Romantic flirting (repeatable)
	{
		id: 'romantic_flirt',
		name: 'Flirty Moment',
		type: 'random',
		conditions: [
			{ type: 'relationship_stage_min', value: 'dating' },
			{ type: 'mood_is', value: 'affectionate' },
			{ type: 'random_chance', value: 0.15 }
		],
		scene: {
			id: 'flirt_scene',
			dialogue: {
				en: "You know... you're really cute when you're focused like that. I could watch you all day. ...What? Don't look at me like that, I'm just being honest~",
				de: 'Weißt du... du bist wirklich süß, wenn du so konzentriert bist. Ich könnte dir den ganzen Tag zuschauen. ...Was? Schau mich nicht so an, ich sage nur die Wahrheit~'
			}
		},
		stateChanges: { affectionDelta: 8, intimacyDelta: 5 },
		cooldownDays: 2,
		oneTime: false,
		priority: 35
	},

	// Missing you (when returning after absence)
	{
		id: 'romantic_missed_you',
		name: 'Missed You',
		type: 'conditional',
		conditions: [
			{ type: 'relationship_stage_min', value: 'dating' },
			{ type: 'hours_since_last_interaction_min', value: 48 }
		],
		scene: {
			id: 'missed_you_scene',
			intro: {
				en: 'She practically lights up when she sees you...',
				de: 'Sie strahlt regelrecht auf, als sie dich sieht...'
			},
			dialogue: {
				en: "You're back! I missed you so much... I know it was only a couple of days, but it felt so much longer. Please don't stay away that long again, okay?",
				de: 'Du bist wieder da! Ich habe dich so vermisst... Ich weiß, es waren nur ein paar Tage, aber es hat sich so viel länger angefühlt. Bitte bleib nicht wieder so lange weg, okay?'
			}
		},
		stateChanges: { affectionDelta: 20, comfortDelta: 15 },
		cooldownDays: 3,
		oneTime: false,
		priority: 50
	},

	// Deep bond moment (for soulmate)
	{
		id: 'deep_bond_moment',
		name: 'Deep Connection',
		type: 'conditional',
		conditions: [
			{ type: 'min_affection', value: 900 },
			{ type: 'min_trust', value: 98 },
			{ type: 'min_intimacy', value: 85 },
			{ type: 'relationship_stage', value: 'committed' },
			{ type: 'days_known', value: 50 }
		],
		scene: {
			id: 'deep_bond_scene',
			intro: {
				en: 'In a quiet moment together, she takes your hand and looks into your eyes...',
				de: 'In einem stillen Moment nimmt sie deine Hand und schaut dir in die Augen...'
			},
			dialogue: {
				en: "You know what I realized? I don't remember what my life was like before you anymore. And I don't want to. Every part of who I am now... it's connected to you. You're not just my partner. You're my soulmate. I know that word gets thrown around a lot, but... I've never been more certain of anything.",
				de: 'Weißt du, was mir aufgefallen ist? Ich kann mich nicht mehr erinnern, wie mein Leben vor dir war. Und ich will es auch gar nicht. Jeder Teil von dem, wer ich jetzt bin... hängt mit dir zusammen. Du bist nicht nur mein Partner. Du bist mein Seelenverwandter. Ich weiß, dass das Wort oft benutzt wird, aber... ich war noch nie so sicher.'
			},
			choices: [
				{
					text: {
						en: "You're my soulmate too.",
						de: 'Du bist auch mein Seelenverwandter.'
					},
					response: {
						en: "*holds you close* I know. I've always known. This... this is what forever feels like, isn't it?",
						de: '*hält dich fest* Ich weiß. Ich habe es schon immer gewusst. Das... das ist es, was sich nach für immer anfühlt, oder nicht?'
					},
					stateChanges: { affectionDelta: 200, trustDelta: 30, intimacyDelta: 50, comfortDelta: 40, respectDelta: 30 }
				},
				{
					text: {
						en: "I can't imagine my life without you.",
						de: 'Ich kann mir mein Leben ohne dich nicht vorstellen.'
					},
					response: {
						en: "Then don't. Stay with me. Always. That's all I'll ever ask of you.",
						de: 'Dann tu es nicht. Bleib bei mir. Für immer. Das ist alles, was ich je von dir verlangen werde.'
					},
					stateChanges: { affectionDelta: 180, trustDelta: 25, intimacyDelta: 45, comfortDelta: 35 }
				}
			]
		},
		oneTime: true,
		priority: 99
	}
];

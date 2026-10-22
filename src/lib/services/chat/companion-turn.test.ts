import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Companion-turn unit test with the real response parser and prompt builder;
// only stores, persistence and the extraction LLM call are replaced. Covers the
// image intent that rides in the state JSON: inline block and — the regression
// this guards — the forced-JSON extraction fallback when the model skips it.
test('processCompanionTurn surfaces image intent from inline JSON and the extraction fallback', async (t) => {
	const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');

	const characterState = {
		name: 'Utsuwa',
		appMode: 'dating_sim',
		completedEvents: [] as string[],
		energy: 80,
		mood: { primary: 'content', intensity: 50 },
		affection: 10,
		trust: 10,
		intimacy: 0,
		comfort: 0,
		respect: 0
	};

	let extractionResponses: string[] = [];
	const extractionSysPrompts: string[] = [];
	const extractionUserPrompts: string[] = [];
	const appliedUpdates: unknown[] = [];

	const fixtures = {
		characterStore: {
			state: characterState,
			get appMode() {
				return characterState.appMode;
			},
			applyUpdates: (updates: unknown) => {
				appliedUpdates.push(updates);
			},
			setRelationshipStage: () => {}
		},
		vrmStore: { requestFlash: () => {} },
		reminderStore: { addReminder: async () => {} },
		requestAvatarAction: () => {},
		memoryApi: { createFact: async () => {} },
		determineFactCategory: () => 'general',
		calculateFactImportance: () => 1,
		recordTurn: async () => {},
		ensureSession: async () => null,
		checkAllEvents: () => [],
		checkEvent: () => ({ triggered: false }),
		eventsApi: { getCompletedEvents: async () => [] },
		analyzeMessage: () => ({ sentiment: 0, nonLatinDominant: false }),
		calculateBaselineUpdates: () => ({}),
		mergeUpdates: (_baseline: unknown, llm: unknown) => llm ?? {},
		checkAndApplyStageTransition: () => ({ transitioned: false }),
		completeJson: async (opts: { system: string; user: string }) => {
			extractionSysPrompts.push(opts.system);
			extractionUserPrompts.push(opts.user);
			return extractionResponses.shift() ?? null;
		}
	};
	(globalThis as unknown as Record<string, unknown>).__utsuwaTurnTest = fixtures;

	const replacements: Record<string, string> = {
		'src/lib/stores/character.svelte': 'export const characterStore = globalThis.__utsuwaTurnTest.characterStore;',
		'src/lib/stores/vrm.svelte': 'export const vrmStore = globalThis.__utsuwaTurnTest.vrmStore;',
		'src/lib/stores/reminders.svelte': 'export const reminderStore = globalThis.__utsuwaTurnTest.reminderStore;',
		'src/lib/engine/heuristics': 'export const analyzeMessage = (...a) => globalThis.__utsuwaTurnTest.analyzeMessage(...a); export const calculateBaselineUpdates = (...a) => globalThis.__utsuwaTurnTest.calculateBaselineUpdates(...a);',
		'src/lib/engine/state-updates': 'export const mergeUpdates = (...a) => globalThis.__utsuwaTurnTest.mergeUpdates(...a); export const checkAndApplyStageTransition = (...a) => globalThis.__utsuwaTurnTest.checkAndApplyStageTransition(...a);',
		'src/lib/engine/memory': 'export const memoryApi = globalThis.__utsuwaTurnTest.memoryApi; export const determineFactCategory = (...a) => globalThis.__utsuwaTurnTest.determineFactCategory(...a); export const calculateFactImportance = (...a) => globalThis.__utsuwaTurnTest.calculateFactImportance(...a);',
		'src/lib/engine/memory-session': 'export const recordTurn = (...a) => globalThis.__utsuwaTurnTest.recordTurn(...a); export const ensureSession = (...a) => globalThis.__utsuwaTurnTest.ensureSession(...a);',
		'src/lib/engine/event-matching': 'export const checkAllEvents = (...a) => globalThis.__utsuwaTurnTest.checkAllEvents(...a); export const checkEvent = (...a) => globalThis.__utsuwaTurnTest.checkEvent(...a);',
		'src/lib/engine/events': 'export const eventsApi = globalThis.__utsuwaTurnTest.eventsApi;',
		'src/lib/data/events': 'export const allEvents = []; export const relationshipStrainEvent = { id: "strain" };',
		'src/lib/services/llm/transport': 'export const completeJson = (...a) => globalThis.__utsuwaTurnTest.completeJson(...a);',
		'src/lib/services/animation-actions': 'export const requestAvatarAction = (...a) => globalThis.__utsuwaTurnTest.requestAvatarAction(...a);'
	};

	const server = await createServer({
		root,
		configFile: false,
		server: { middlewareMode: true },
		appType: 'custom',
		resolve: {
			alias: [
				...Object.keys(replacements).map((key) => ({
					find: key.replace('src/lib/', '$lib/'),
					replacement: '\0turn-test:' + key
				})),
				{ find: '$lib', replacement: `${root}/src/lib` }
			]
		},
		optimizeDeps: { noDiscovery: true, entries: [] },
		plugins: [
			{
				name: 'turn-test-replacements',
				resolveId(id) {
					if (id.startsWith('\0turn-test:')) return id;
					const key = id.startsWith(`${root}/`) ? id.slice(root.length + 1).replace(/\.ts$/, '') : id;
					if (key in replacements) return '\0turn-test:' + key;
				},
				load(id) {
					if (id.startsWith('\0turn-test:')) return replacements[id.slice('\0turn-test:'.length)];
				}
			}
		]
	});

	const llm = { provider: 'openai-compatible', model: 'test-model', apiKey: 'test-key', baseUrl: 'https://provider.invalid/v1/', hasImages: false };

	try {
		const { processCompanionTurn } = await server.ssrLoadModule('/src/lib/services/chat/companion-turn.ts');

		await t.test('reads show_images from an inline state block without an extraction call', async () => {
			extractionResponses = [];
			extractionSysPrompts.length = 0;
			const raw = 'With pleasure! Here are a few sweet cats.\n```json\n{"mood_change":{"emotion":"happy"},"show_images":["https://x/cat1.jpg","https://x/cat2.png"]}\n```';
			const result = await processCompanionTurn({ userMessage: 'show me cats', companionResponse: raw, llm, showImagesEnabled: true });
			assert.deepEqual(result.showImages, ['https://x/cat1.jpg', 'https://x/cat2.png']);
			assert.equal(result.closeImages, undefined);
			assert.equal(extractionSysPrompts.length, 0, 'no extraction call when the inline block parses');
		});

		await t.test('recovers image URLs from the extraction fallback when the model skips the block (regression)', async () => {
			extractionResponses = ['{"mood_change":{"emotion":"neutral","intensity_delta":0},"new_memory":null,"image_search":"cute cats","say":"Here are a few sweet cats."}'];
			extractionSysPrompts.length = 0;
			extractionUserPrompts.length = 0;
			// Exactly the failing shape: a promised picture, no state block.
			const result = await processCompanionTurn({
				userMessage: 'zeig mir ein Bild von Katzen',
				companionResponse: 'Hier ist ein süßes Katzenbild für dich.',
				llm,
				showImagesEnabled: true,
				toolResults: ['searxng: https://x/cat1.jpg (a cat)']
			});
			assert.equal(extractionSysPrompts.length, 1, 'extraction fallback ran');
			assert.equal(result.imageSearch, 'cute cats');
			// The fallback line replaces the untrusted model reply.
			assert.equal(result.fallbackDialogue, 'Here are a few sweet cats.');
			// The tool results were handed to the extraction so it can copy URLs.
			assert.ok(extractionUserPrompts[0].includes('https://x/cat1.jpg'));
		});

		await t.test('recovers URLs even when the model emitted a state block without show_images', async () => {
			extractionResponses = ['{"show_images":["https://x/cat1.jpg"]}'];
			extractionSysPrompts.length = 0;
			const result = await processCompanionTurn({
				userMessage: 'show me cats',
				companionResponse: 'Here you go!\n```json\n{"mood_change":{"emotion":"happy"}}\n```',
				llm,
				showImagesEnabled: true,
				toolResults: ['result: https://x/cat1.jpg']
			});
			assert.deepEqual(result.showImages, ['https://x/cat1.jpg']);
		});

		await t.test('the extraction prompt offers hand-off fields only when enabled', async () => {
			extractionResponses = ['{"mood_change":{"emotion":"neutral"}}'];
			extractionSysPrompts.length = 0;
			await processCompanionTurn({ userMessage: 'hi', companionResponse: 'Hey!', llm, showImagesEnabled: false });
			assert.equal(extractionSysPrompts.length, 1);
			assert.ok(!extractionSysPrompts[0].includes('"show_images"'));

			extractionResponses = ['{"mood_change":{"emotion":"neutral"}}'];
			extractionSysPrompts.length = 0;
			await processCompanionTurn({ userMessage: 'hi', companionResponse: 'Hey!', llm, showImagesEnabled: true });
			assert.ok(extractionSysPrompts[0].includes('"show_images"'));
		});

		await t.test('close_images flows through, and a turn with no intent stays undefined', async () => {
			const closing = await processCompanionTurn({
				userMessage: 'close the pictures',
				companionResponse: 'Sure!\n```json\n{"close_images":true}\n```',
				llm,
				showImagesEnabled: true
			});
			assert.equal(closing.closeImages, true);
			assert.equal(closing.showImages, undefined);

			const plain = await processCompanionTurn({
				userMessage: 'how was your day?',
				companionResponse: 'It was calm.\n```json\n{"mood_change":{"emotion":"content"}}\n```',
				llm,
				showImagesEnabled: true
			});
			assert.equal(plain.showImages, undefined);
			assert.equal(plain.closeImages, undefined);
		});
	} finally {
		await server.close();
	}
});

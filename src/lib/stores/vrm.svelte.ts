import { browser } from '$app/environment';
import type { VRM } from '@pixiv/three-vrm';
import localforage from 'localforage';
import { isTauri } from '$lib/services/platform/platform';
import {
	DEFAULT_EMOTION_MAPPINGS,
	type EmotionMapping
} from '$lib/services/vrm/expression-controller';
import { getKnownEmotionTags } from '$lib/utils/sentences';

export interface VrmModel {
	id: string;
	name: string;
	url: string;
	previewUrl?: string;
	isDefault: boolean;
	createdAt: number;
}

type EmotionProfile = Record<string, EmotionMapping>;
type EmotionProfilesByModel = Record<string, EmotionProfile>;

const EXPRESSION_AUTO_ALIASES: Record<string, string[]> = {
	laugh: ['joy', 'happy', 'fun'],
	giggle: ['joy', 'happy', 'fun'],
	chuckle: ['fun', 'joy', 'happy'],
	excited: ['joy', 'surprised', 'happy'],
	sad: ['sorrow', 'sad'],
	sigh: ['sorrow', 'sad'],
	calm: ['relaxed', 'neutral'],
	whisper: ['relaxed', 'neutral'],
	dramatic: ['surprised', 'angry']
};

// Default models bundled with the app (first one is loaded by default)
const DEFAULT_MODELS: VrmModel[] = [
	{
		id: 'default-utsuwa',
		name: 'Utsuwa',
		url: '/models/utsuwa.vrm',
		previewUrl: undefined,
		isDefault: true,
		createdAt: 0
	}
];

// Configure localforage for VRM storage
const vrmStorage = browser
	? localforage.createInstance({
			name: 'utsuwa-vrm',
			storeName: 'models'
		})
	: null;

// Configure localforage for custom animation storage
const animationStorage = browser
	? localforage.createInstance({
			name: 'utsuwa-vrm',
			storeName: 'animations'
		})
	: null;

function normalizeExpressionName(name: string): string {
	return name.toLowerCase().replace(/[\s_-]+/g, '');
}

function cloneProfile(profile: EmotionProfile): EmotionProfile {
	const out: EmotionProfile = {};
	for (const [emotion, config] of Object.entries(profile)) {
		out[emotion] = { ...config };
	}
	return out;
}

export interface AnimationEntry {
	id: string;
	name: string;
	url: string;
	missing?: boolean;
	description?: string;
	llmEnabled?: boolean;
}

function createVrmStore() {
	// Current model state - null until initFromStorage determines the correct model
	let modelUrl = $state<string | null>(null);
	let vrm = $state<VRM | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	// Gallery state
	let models = $state<VrmModel[]>([...DEFAULT_MODELS]);
	let activeModelId = $state<string | null>(DEFAULT_MODELS[0].id);

	// Available expressions on current model (persists across navigation)
	let availableExpressions = $state<string[]>([]);

	// Animation state
	let currentAnimation = $state<string | null>(null);

	// Talking animation state (triggered by text output)
	let isTalking = $state(false);
	let talkingTimeout: ReturnType<typeof setTimeout> | null = null;
	let currentEmotion = $state<string | null>(null);
	let pendingAction = $state<string | null>(null);
	let emotionProfilesByModel = $state<EmotionProfilesByModel>({});

	// Head position for 3D speech bubble positioning
	let headPosition = $state<[number, number, number]>([0, 1.6, 0]);
	// Screen-space position (x, y as percentages 0-100)
	let headScreenPosition = $state<{ x: number; y: number } | null>(null);
	// Screen-space position well above the head top — used for typing indicator only
	let headTopScreenPosition = $state<{ x: number; y: number } | null>(null);
	// Expressions manually overridden on the Developer page — Map of
	// expression name → current value. These are protected from automatic
	// systems (blink, lip-sync, emotion controller, lookAt) and re-applied
	// every frame so the LookAt system doesn't overwrite them.
	let developerExpressionOverrides = $state<Map<string, number>>(new Map());

	// ── Temporary model (for Developer Tools preview) ──
	// When a temp model is loaded we stash the original activeModelId so
	// we can restore it later.  The temp blob URL is kept in memory only
	// and is never persisted to storage.
	let tempModelOriginalId = $state<string | null>(null);
	let tempModelUrl = $state<string | null>(null);
	// Default animations
	const idleAnimationUrl = '/animations/idle.vrma';
	const talkingAnimationUrl = '/animations/talking.vrma';

	// All idle animations for random cycling
	const idleAnimationUrls = [
		'/animations/idle.vrma',
		'/animations/idle_2.vrma',
		'/animations/idle_3.vrma',
		'/animations/idle_4.vrma',
		'/animations/idle_5.vrma'
	];

	const STATIC_ANIMATIONS: AnimationEntry[] = [
		// Motion clips — VRoid Motion Pack (pixiv Inc. VRoid Project)
		{ id: 'VRMA_01', name: 'Show Full Body', url: '/animations/VRMA_01.vrma' },
		{ id: 'VRMA_02', name: 'Greeting', url: '/animations/VRMA_02.vrma' },
		{ id: 'VRMA_03', name: 'Peace Sign', url: '/animations/VRMA_03.vrma' },
		{ id: 'VRMA_04', name: 'Shoot', url: '/animations/VRMA_04.vrma' },
		{ id: 'VRMA_05', name: 'Spin', url: '/animations/VRMA_05.vrma' },
		{ id: 'VRMA_06', name: 'Model Pose', url: '/animations/VRMA_06.vrma' },
		{ id: 'VRMA_07', name: 'Squat', url: '/animations/VRMA_07.vrma' },
		// Emotion / pose VRMAs — tk256ailab/vrm-viewer (demo animations)
		{ id: 'angry', name: 'Angry', url: '/animations/Angry.vrma' },
		{ id: 'blush', name: 'Blush', url: '/animations/Blush.vrma' },
		{ id: 'clapping', name: 'Clapping', url: '/animations/Clapping.vrma' },
		{ id: 'goodbye', name: 'Goodbye', url: '/animations/Goodbye.vrma' },
		{ id: 'lookaround', name: 'Look Around', url: '/animations/LookAround.vrma' },
		{ id: 'relax', name: 'Relax', url: '/animations/Relax.vrma' },
		{ id: 'sad-pose', name: 'Sad', url: '/animations/Sad.vrma' },
		{ id: 'sleepy', name: 'Sleepy', url: '/animations/Sleepy.vrma' },
		{ id: 'surprised-pose', name: 'Surprised', url: '/animations/Surprised.vrma' },
		{ id: 'thinking-pose', name: 'Thinking', url: '/animations/Thinking.vrma' },
		// Actions mapped to available VRMA files (LLM [action:xxx] tags)
		{ id: 'wave', name: 'Wave', url: '/animations/Goodbye.vrma', description: 'Wave hello or goodbye' },
		{ id: 'nod', name: 'Nod', url: '/animations/nod.vrma', missing: true, description: 'Nod in agreement' },
		{ id: 'shake', name: 'Shake Head', url: '/animations/shake.vrma', missing: true, description: 'Shake head in disagreement' },
		{ id: 'jump', name: 'Jump', url: '/animations/Jump.vrma', description: 'Jump for joy or excitement' },
		{ id: 'bow', name: 'Bow', url: '/animations/bow.vrma', missing: true, description: 'Bow in thanks or apology' },
		{ id: 'think', name: 'Think', url: '/animations/Thinking.vrma', description: 'Strike a thinking pose' },
		{ id: 'clap', name: 'Clap', url: '/animations/Clapping.vrma', description: 'Applaud or clap hands' },
		{ id: 'dance', name: 'Dance', url: '/animations/dance.vrma', missing: true, description: 'Dance happily' }
	];

	// User-uploaded custom VRMA animations (persisted in IndexedDB)
	let customAnimations = $state<AnimationEntry[]>([]);

	// Animation metadata (description, llmEnabled) — persisted separately from blobs
	let animationMetadata = $state<Record<string, { description?: string; llmEnabled?: boolean }>>({});

	// Guard against saveToStorage running before init completes
	let storageReady = false;
	// Prevents re-emitting sync events when handling incoming ones
	let isSyncing = false;

	function findExpressionByAliases(expressions: string[], aliases: string[]): string {
		if (!expressions.length) return '';
		const normalized = new Map(expressions.map((expr) => [normalizeExpressionName(expr), expr]));
		for (const alias of aliases) {
			const key = normalizeExpressionName(alias);
			const match = normalized.get(key);
			if (match) return match;
		}
		return '';
	}

	function buildAutoProfile(expressions: string[]): EmotionProfile {
		const known = getKnownEmotionTags();
		const profile: EmotionProfile = {};
		for (const emotion of known) {
			const base = DEFAULT_EMOTION_MAPPINGS[emotion] ?? {
				expression: '',
				intensity: 0.5,
				fadeIn: 0.25,
				fadeOut: 0.8
			};
			const aliases = EXPRESSION_AUTO_ALIASES[emotion] ?? [base.expression];
			const expression = findExpressionByAliases(expressions, aliases);
			profile[emotion] = {
				expression: expression || '',
				intensity: base.intensity,
				fadeIn: base.fadeIn,
				fadeOut: base.fadeOut
			};
		}
		return profile;
	}

	function ensureEmotionProfileForModel(modelId: string | null, expressions: string[]): void {
		if (!modelId || emotionProfilesByModel[modelId]) return;
		emotionProfilesByModel = {
			...emotionProfilesByModel,
			[modelId]: buildAutoProfile(expressions)
		};
		void saveToStorage();
	}

	// Initialize from storage (may override defaults with saved values)
	if (browser) {
		initFromStorage();

		// Sync model changes from other Tauri windows
		if (isTauri()) {
			import('@tauri-apps/api/event').then(({ listen }) => {
				listen('vrm:model-changed', async () => {
					isSyncing = true;
					await syncActiveModel();
					isSyncing = false;
				});
			});
		}
	}

	async function initFromStorage() {
		try {
			// Load saved models list
			const savedModels = await vrmStorage?.getItem<VrmModel[]>('model-list');
			if (savedModels && savedModels.length > 0) {
				const customModels = savedModels.filter((m) => !m.isDefault);
				const restored: VrmModel[] = [];

				for (const model of customModels) {
					// Regenerate blob URL from stored blob data
					const blob = await vrmStorage?.getItem<Blob>(`model-blob-${model.id}`);
					if (blob) {
						restored.push({
							...model,
							url: URL.createObjectURL(blob)
						});
					}
					// If blob is missing, skip this model (unrecoverable)
				}

				models = [...DEFAULT_MODELS, ...restored];
			}

			const savedProfiles =
				await vrmStorage?.getItem<EmotionProfilesByModel>('expression-profiles-by-model');
			if (savedProfiles && typeof savedProfiles === 'object') {
				emotionProfilesByModel = savedProfiles;
			}

			// Restore preview thumbnails for all models
			for (let i = 0; i < models.length; i++) {
				const savedPreview = await vrmStorage?.getItem<string>(`model-preview-${models[i].id}`);
				if (savedPreview) {
					models[i] = { ...models[i], previewUrl: savedPreview };
				}
			}
			// Trigger reactivity
			models = [...models];

			// Load active model ID
			const savedActiveId = await vrmStorage?.getItem<string>('active-model-id');
			if (savedActiveId) {
				const activeModel = models.find((m) => m.id === savedActiveId);
				if (activeModel) {
					activeModelId = savedActiveId;
					modelUrl = activeModel.url;
				} else {
					activeModelId = DEFAULT_MODELS[0].id;
					modelUrl = DEFAULT_MODELS[0].url;
					await vrmStorage?.removeItem('active-model-id');
				}
			} else {
				activeModelId = DEFAULT_MODELS[0].id;
				modelUrl = DEFAULT_MODELS[0].url;
			}

			// Load custom animations
			const savedAnims = await animationStorage?.getItem<{ id: string; name: string }[]>('custom-animation-list');
			if (savedAnims && savedAnims.length > 0) {
				const restored: { id: string; name: string; url: string }[] = [];
				for (const anim of savedAnims) {
					const blob = await animationStorage?.getItem<Blob>(`animation-blob-${anim.id}`);
					if (blob) {
						restored.push({
							id: anim.id,
							name: anim.name,
							url: URL.createObjectURL(blob)
						});
					}
				}
				customAnimations = restored;
			}

			// Load animation metadata (descriptions, llmEnabled flags)
			const savedMeta = await animationStorage?.getItem<Record<string, { description?: string; llmEnabled?: boolean }>>('animation-metadata');
			if (savedMeta) {
				animationMetadata = savedMeta;
				// Apply saved metadata back onto STATIC_ANIMATIONS so user edits survive reloads
				for (let i = 0; i < STATIC_ANIMATIONS.length; i++) {
					const meta = savedMeta[STATIC_ANIMATIONS[i].id];
					if (meta) {
						STATIC_ANIMATIONS[i] = {
							...STATIC_ANIMATIONS[i],
							...(meta.description !== undefined && { description: meta.description }),
							...(meta.llmEnabled !== undefined && { llmEnabled: meta.llmEnabled })
						};
					}
				}
			}
		} catch (e) {
			console.error('Failed to load VRM storage:', e);
			activeModelId = DEFAULT_MODELS[0].id;
			modelUrl = DEFAULT_MODELS[0].url;
		}
		storageReady = true;
		// Flush any saves that were blocked during init
		await saveToStorage();
	}

	async function saveToStorage() {
		if (!vrmStorage || !storageReady) return;
		try {
			// Save custom models (not defaults) — strip blob URLs since they're ephemeral.
			// JSON round-trip strips Svelte 5 reactive Proxies so IndexedDB structuredClone works.
			const customModels = models
				.filter((m) => !m.isDefault)
				.map(({ url, previewUrl, ...rest }) => rest);
			await vrmStorage.setItem('model-list', JSON.parse(JSON.stringify(customModels)));
			await vrmStorage.setItem('active-model-id', activeModelId);
			await vrmStorage.setItem('expression-profiles-by-model', JSON.parse(JSON.stringify(emotionProfilesByModel)));
		} catch (e) {
			console.error('Failed to save VRM storage:', e);
		}
	}

	function setModelUrl(url: string | null) {
		modelUrl = url;
		error = null;
	}

	function setVrm(instance: VRM | null) {
		vrm = instance;
		// Store available expressions when VRM is set
		if (instance?.expressionManager) {
			availableExpressions = instance.expressionManager.expressions.map((e) => e.expressionName);
			ensureEmotionProfileForModel(activeModelId, availableExpressions);
		}
	}

	function setLoading(loading: boolean) {
		isLoading = loading;
	}

	function setError(err: string | null) {
		// Clear any existing timeout
		if (errorTimeout) {
			clearTimeout(errorTimeout);
			errorTimeout = null;
		}
		error = err;
		isLoading = false;
		// Auto-dismiss after 5 seconds if error is set
		if (err) {
			errorTimeout = setTimeout(() => {
				error = null;
				errorTimeout = null;
			}, 5000);
		}
	}

	async function setActiveModel(id: string) {
		const model = models.find((m) => m.id === id);
		if (model) {
			activeModelId = id;
			modelUrl = model.url;
			await saveToStorage();
			broadcastModelChange();
		}
	}

	async function broadcastModelChange() {
		if (!isTauri() || isSyncing) return;
		const { emit } = await import('@tauri-apps/api/event');
		emit('vrm:model-changed');
	}

	async function syncActiveModel() {
		if (!storageReady) return;
		const savedActiveId = await vrmStorage?.getItem<string>('active-model-id');
		if (!savedActiveId || savedActiveId === activeModelId) return;

		// Check if model exists in our list already
		const model = models.find((m) => m.id === savedActiveId);
		if (model) {
			activeModelId = savedActiveId;
			modelUrl = model.url;
		} else {
			// New custom model added in another window — full re-init
			await initFromStorage();
		}
	}

	function setHeadPosition(pos: [number, number, number]) {
		headPosition = pos;
	}

	function setHeadScreenPosition(pos: { x: number; y: number } | null) {
		headScreenPosition = pos;
	}

	function setHeadTopScreenPosition(pos: { x: number; y: number } | null) {
		headTopScreenPosition = pos;
	}

	function setCurrentAnimation(animationIdOrPath: string | null) {
		// Accept either an animation ID or a direct path
		// If it's a path (starts with /), use it directly
		// Otherwise, look up the animation by ID
		if (animationIdOrPath === null || animationIdOrPath === 'none') {
			currentAnimation = null;
		} else if (animationIdOrPath.startsWith('/')) {
			// Direct path - use as-is
			currentAnimation = animationIdOrPath;
		} else {
			// Look up by ID in all available animations (static + custom)
			const anim = [...STATIC_ANIMATIONS, ...customAnimations].find((a) => a.id === animationIdOrPath);
			currentAnimation = anim?.url || null;
		}
	}

	// Start talking animation based on text length
	// Estimates ~15 characters per second of speaking
	function startTalking(text: string) {
		// Clear any existing timeout
		if (talkingTimeout) {
			clearTimeout(talkingTimeout);
		}

		// Calculate duration: ~15 chars/sec, minimum 1 second
		const charsPerSecond = 15;
		const duration = Math.max(1, text.length / charsPerSecond) * 1000;

		isTalking = true;

		// Auto-stop after estimated duration
		talkingTimeout = setTimeout(() => {
			isTalking = false;
			talkingTimeout = null;
		}, duration);
	}

	// Stop talking animation immediately
	function stopTalking() {
		if (talkingTimeout) {
			clearTimeout(talkingTimeout);
			talkingTimeout = null;
		}
		isTalking = false;
	}

	function setEmotion(emotion: string | null) {
		currentEmotion = emotion;
	}

	function triggerAction(action: string) {
		pendingAction = action;
	}

	function setDeveloperExpressionOverride(name: string, value: number) {
		const next = new Map(developerExpressionOverrides);
		if (value > 0) {
			next.set(name, value);
		} else {
			next.delete(name);
		}
		developerExpressionOverrides = next;
	}

	function clearDeveloperExpressionOverrides() {
		developerExpressionOverrides = new Map();
	}

	function clearPendingAction() {
		pendingAction = null;
	}

	function getActiveEmotionProfile(): EmotionProfile | null {
		if (!activeModelId) return null;
		const profile = emotionProfilesByModel[activeModelId];
		if (profile) return profile;
		return null;
	}

	function setEmotionMapping(
		emotion: string,
		patch: Partial<Pick<EmotionMapping, 'expression' | 'intensity' | 'fadeIn' | 'fadeOut'>>
	) {
		if (!activeModelId) return;

		const existing =
			getActiveEmotionProfile() ??
			buildAutoProfile(availableExpressions);
		const current = existing[emotion] ?? {
			expression: '',
			intensity: 0.5,
			fadeIn: 0.25,
			fadeOut: 0.8
		};

		const nextProfile: EmotionProfile = cloneProfile(existing);
		nextProfile[emotion] = {
			expression: patch.expression ?? current.expression,
			intensity: patch.intensity ?? current.intensity,
			fadeIn: patch.fadeIn ?? current.fadeIn,
			fadeOut: patch.fadeOut ?? current.fadeOut
		};

		emotionProfilesByModel = {
			...emotionProfilesByModel,
			[activeModelId]: nextProfile
		};
		void saveToStorage();
	}

	function resetEmotionMappingsForActiveModel() {
		if (!activeModelId) return;
		emotionProfilesByModel = {
			...emotionProfilesByModel,
			[activeModelId]: buildAutoProfile(availableExpressions)
		};
		void saveToStorage();
	}

	async function loadTempModel(file: File): Promise<void> {
		// Restore any previous temp model first to avoid leaking blob URLs
		if (tempModelUrl) {
			URL.revokeObjectURL(tempModelUrl);
		}

		// Remember which model was active before (only on first temp load)
		if (!tempModelOriginalId) {
			tempModelOriginalId = activeModelId;
		}

		const blob = new Blob([await file.arrayBuffer()], { type: 'model/vrm' });
		tempModelUrl = URL.createObjectURL(blob);
		modelUrl = tempModelUrl;
		// Clear activeModelId so the scene knows this is a temp model
		activeModelId = null;
		// Reset expressions for the new model
		availableExpressions = [];
	}

	async function restoreOriginalModel(): Promise<void> {
		if (tempModelUrl) {
			URL.revokeObjectURL(tempModelUrl);
			tempModelUrl = null;
		}
		if (tempModelOriginalId) {
			const original = models.find((m) => m.id === tempModelOriginalId);
			if (original) {
				activeModelId = tempModelOriginalId;
				modelUrl = original.url;
			} else {
				// Fallback to default if original was deleted in the meantime
				activeModelId = DEFAULT_MODELS[0].id;
				modelUrl = DEFAULT_MODELS[0].url;
			}
			tempModelOriginalId = null;
		}
	}

	async function addModel(file: File, previewDataUrl?: string): Promise<void> {
		const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const name = file.name.replace(/\.vrm$/i, '');

		// Store the file blob
		const blob = new Blob([await file.arrayBuffer()], { type: 'model/vrm' });
		await vrmStorage?.setItem(`model-blob-${id}`, blob);

		// Create blob URL for immediate use
		const url = URL.createObjectURL(blob);

		const newModel: VrmModel = {
			id,
			name,
			url,
			previewUrl: previewDataUrl,
			isDefault: false,
			createdAt: Date.now()
		};

		models = [...models, newModel];
		await saveToStorage();

		// Store preview if provided
		if (previewDataUrl) {
			await vrmStorage?.setItem(`model-preview-${id}`, previewDataUrl);
		}
	}

	async function removeModel(id: string): Promise<void> {
		const model = models.find((m) => m.id === id);
		if (!model || model.isDefault) return;

		// Revoke blob URL to free memory
		if (model.url.startsWith('blob:')) {
			URL.revokeObjectURL(model.url);
		}

		// Remove from storage
		await vrmStorage?.removeItem(`model-blob-${id}`);
		await vrmStorage?.removeItem(`model-preview-${id}`);

		// Remove from list
		models = models.filter((m) => m.id !== id);

		// If this was the active model, switch to default
		if (activeModelId === id) {
			setActiveModel(DEFAULT_MODELS[0].id);
		}

		await saveToStorage();
	}

		async function renameModel(id: string, name: string): Promise<void> {
			const model = models.find((m) => m.id === id);
			if (!model || !name.trim()) return;

			model.name = name.trim();
			models = [...models]; // trigger reactivity
			await saveToStorage();
		}

	async function loadModelBlob(id: string): Promise<string | null> {
		const model = models.find((m) => m.id === id);
		if (!model) return null;

		// Default models use static URLs
		if (model.isDefault) {
			return model.url;
		}

		// Custom models need to load blob from storage
		try {
			const blob = await vrmStorage?.getItem<Blob>(`model-blob-${id}`);
			if (blob) {
				return URL.createObjectURL(blob);
			}
		} catch (e) {
			console.error('Failed to load model blob:', e);
		}
		return null;
	}

	// ── Custom Animation Management ──

	async function addAnimation(file: File, customName?: string): Promise<void> {
		const id = `anim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const name = customName?.trim() || file.name.replace(/\.vrma$/i, '');

		const arrayBuffer = await file.arrayBuffer();

		// Sanity-check: GLB magic bytes? (0x676C5446 = 'glTF')
		const magic = new Uint32Array(arrayBuffer.slice(0, 4))[0];
		if (magic !== 0x46546c67) {
			// Not a GLB — check if it's a plain GLTF JSON
			const text = new TextDecoder().decode(arrayBuffer.slice(0, 256));
			if (!text.trimStart().startsWith('{')) {
				console.warn('[vrmStore] Uploaded file does not look like a GLB or GLTF:', file.name, 'magic=', magic?.toString(16));
			}
		}

		const blob = new Blob([arrayBuffer], { type: 'model/vrm-animation' });
		await animationStorage?.setItem(`animation-blob-${id}`, blob);

		const url = URL.createObjectURL(blob);
		customAnimations = [...customAnimations, { id, name, url, llmEnabled: true }];

		// Persist list (without blob URLs — they are ephemeral)
		const list = customAnimations.map(({ url, ...rest }) => rest);
		await animationStorage?.setItem('custom-animation-list', JSON.parse(JSON.stringify(list)));
	}

	async function removeAnimation(id: string): Promise<void> {
		const anim = customAnimations.find((a) => a.id === id);
		if (!anim) return;

		// Revoke blob URL to free memory
		if (anim.url.startsWith('blob:')) {
			URL.revokeObjectURL(anim.url);
		}

		await animationStorage?.removeItem(`animation-blob-${id}`);
		customAnimations = customAnimations.filter((a) => a.id !== id);

		const list = customAnimations.map(({ url, ...rest }) => rest);
		await animationStorage?.setItem('custom-animation-list', JSON.parse(JSON.stringify(list)));

		// Clean up metadata
		if (animationMetadata[id]) {
			const next = { ...animationMetadata };
			delete next[id];
			animationMetadata = next;
			await animationStorage?.setItem('animation-metadata', JSON.parse(JSON.stringify(animationMetadata)));
		}
	}

	async function saveAnimationMetadata(): Promise<void> {
		if (!animationStorage) return;
		await animationStorage.setItem('animation-metadata', JSON.parse(JSON.stringify(animationMetadata)));
	}

	function setAnimationDescription(id: string, description: string): void {
		animationMetadata = {
			...animationMetadata,
			[id]: { ...(animationMetadata[id] || {}), description }
		};
		// Also update the entry in the arrays for reactivity
		const staticIdx = STATIC_ANIMATIONS.findIndex((a) => a.id === id);
		if (staticIdx >= 0) {
			STATIC_ANIMATIONS[staticIdx] = { ...STATIC_ANIMATIONS[staticIdx], description };
		}
		const customIdx = customAnimations.findIndex((a) => a.id === id);
		if (customIdx >= 0) {
			customAnimations[customIdx] = { ...customAnimations[customIdx], description };
			customAnimations = [...customAnimations];
		}
		void saveAnimationMetadata();
	}

	function setAnimationLlmEnabled(id: string, enabled: boolean): void {
		animationMetadata = {
			...animationMetadata,
			[id]: { ...(animationMetadata[id] || {}), llmEnabled: enabled }
		};
		// Also update the entry in the arrays for reactivity
		const staticIdx = STATIC_ANIMATIONS.findIndex((a) => a.id === id);
		if (staticIdx >= 0) {
			STATIC_ANIMATIONS[staticIdx] = { ...STATIC_ANIMATIONS[staticIdx], llmEnabled: enabled };
		}
		const customIdx = customAnimations.findIndex((a) => a.id === id);
		if (customIdx >= 0) {
			customAnimations[customIdx] = { ...customAnimations[customIdx], llmEnabled: enabled };
			customAnimations = [...customAnimations];
		}
		void saveAnimationMetadata();
	}


	function getActiveModel(): VrmModel | null {
		return models.find((m) => m.id === activeModelId) || null;
	}

	async function setModelPreview(modelId: string | null, previewDataUrl: string): Promise<void> {
		if (!modelId) return;

		// Update in models array
		const modelIndex = models.findIndex((m) => m.id === modelId);
		if (modelIndex !== -1) {
			models[modelIndex] = { ...models[modelIndex], previewUrl: previewDataUrl };
			// Trigger reactivity
			models = [...models];
		}

		// Save to storage for all models (including defaults) so thumbnails persist
		await vrmStorage?.setItem(`model-preview-${modelId}`, previewDataUrl);
	}

	return {
		get modelUrl() {
			return modelUrl;
		},
		get vrm() {
			return vrm;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get models() {
			return models;
		},
		get activeModelId() {
			return activeModelId;
		},
		get availableExpressions() {
			return availableExpressions;
		},
		get currentAnimation() {
			return currentAnimation;
		},
		get availableAnimations() {
			return [...STATIC_ANIMATIONS, ...customAnimations];
		},
		get allAnimations() {
			return [...STATIC_ANIMATIONS, ...customAnimations];
		},
		get llmActions() {
			// Only animations enabled for LLM use (llmEnabled !== false)
			// and not marked as missing
			return [...STATIC_ANIMATIONS, ...customAnimations]
				.filter((a) => !a.missing && a.llmEnabled !== false)
				.map((a) => ({ id: a.id, description: a.description }));
		},
		get customAnimations() {
			return customAnimations;
		},
		get idleAnimationUrl() {
			return idleAnimationUrl;
		},
		get idleAnimationUrls() {
			return idleAnimationUrls;
		},
		get talkingAnimationUrl() {
			return talkingAnimationUrl;
		},
		get isTalking() {
			return isTalking;
		},
		get currentEmotion() {
			return currentEmotion;
		},
		get pendingAction() {
			return pendingAction;
		},
		get emotionProfile() {
			return getActiveEmotionProfile();
		},
		get headPosition() {
			return headPosition;
		},
		get headScreenPosition() {
			return headScreenPosition;
		},
		get headTopScreenPosition() {
			return headTopScreenPosition;
		},
		get developerExpressionOverrides() {
			return developerExpressionOverrides;
		},
		get tempModelActive() {
			return tempModelUrl !== null;
		},
		setModelUrl,
		setHeadPosition,
		setHeadScreenPosition,
		setHeadTopScreenPosition,
		setVrm,
		setLoading,
		setError,
		setActiveModel,
		setCurrentAnimation,
		startTalking,
		stopTalking,
		setEmotion,
		triggerAction,
		clearPendingAction,
		setEmotionMapping,
		resetEmotionMappingsForActiveModel,
		addModel,
		removeModel,
		renameModel,
		loadModelBlob,

		getActiveModel,
		setModelPreview,
		addAnimation,
		removeAnimation,
		setAnimationDescription,
		setAnimationLlmEnabled,
		setDeveloperExpressionOverride,
		clearDeveloperExpressionOverrides,
		loadTempModel,
		restoreOriginalModel
	};
}

export const vrmStore = createVrmStore();

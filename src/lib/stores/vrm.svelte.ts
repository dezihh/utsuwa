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

	// Animation registry — motions that exist as files in static/animations/
	// Actions (wave, nod, etc.) are referenced in code but may not have VRMA files.
	const availableAnimations: { id: string; name: string; url: string; missing?: boolean }[] = [
		// Motion clips
		{ id: 'VRMA_01', name: 'Motion 1', url: '/animations/VRMA_01.vrma' },
		{ id: 'VRMA_02', name: 'Motion 2', url: '/animations/VRMA_02.vrma' },
		{ id: 'VRMA_03', name: 'Motion 3', url: '/animations/VRMA_03.vrma' },
		{ id: 'VRMA_04', name: 'Motion 4', url: '/animations/VRMA_04.vrma' },
		{ id: 'VRMA_05', name: 'Motion 5', url: '/animations/VRMA_05.vrma' },
		{ id: 'VRMA_06', name: 'Motion 6', url: '/animations/VRMA_06.vrma' },
		{ id: 'VRMA_07', name: 'Motion 7', url: '/animations/VRMA_07.vrma' },
		// Actions (body animations triggered by [action:xxx] tags)
		{ id: 'wave', name: 'Wave', url: '/animations/wave.vrma', missing: true },
		{ id: 'nod', name: 'Nod', url: '/animations/nod.vrma', missing: true },
		{ id: 'shake', name: 'Shake Head', url: '/animations/shake.vrma', missing: true },
		{ id: 'jump', name: 'Jump', url: '/animations/jump.vrma', missing: true },
		{ id: 'bow', name: 'Bow', url: '/animations/bow.vrma', missing: true },
		{ id: 'think', name: 'Think', url: '/animations/think.vrma', missing: true },
		{ id: 'clap', name: 'Clap', url: '/animations/clap.vrma', missing: true },
		{ id: 'dance', name: 'Dance', url: '/animations/dance.vrma', missing: true }
	];

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
			// Look up by ID in availableAnimations
			const anim = availableAnimations.find((a) => a.id === animationIdOrPath);
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
			return availableAnimations;
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
		loadModelBlob,
		getActiveModel,
		setModelPreview
	};
}

export const vrmStore = createVrmStore();

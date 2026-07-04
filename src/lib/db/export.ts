import { browser } from '$app/environment';
import localforage from 'localforage';
import { db, type DBCharacterState } from '$lib/db';
import { characterStore } from '$lib/stores/character.svelte';
import { backgroundStore } from '$lib/stores/background.svelte';
import type { EmotionMapping } from '$lib/services/vrm/expression-controller';
import type {
	CharacterState,
	MoodState,
	RelationshipStage,
	PersonalityProfile
} from '$lib/types/character';
import type { Fact, SessionSummary, ConversationTurn, FactLibraryEntry } from '$lib/types/memory';
import type { CompletedEventRecord } from '$lib/types/events';
import type { KeepsakeRecord } from '$lib/services/storage/keepsakes';

export const SAVE_FILE_VERSION = '3.3';

// Localforage instance for VRM storage (mirrors vrm.svelte.ts)
const vrmStorage = browser
	? localforage.createInstance({ name: 'utsuwa-vrm', storeName: 'models' })
	: null;

// Localforage instance for custom VRMA animations (mirrors vrm.svelte.ts)
const animationStorage = browser
	? localforage.createInstance({ name: 'utsuwa-vrm', storeName: 'animations' })
	: null;

// Localforage instance for keepsakes / photo memories
const keepsakeStorage = browser
	? localforage.createInstance({ name: 'utsuwa-keepsakes', storeName: 'images' })
	: null;

// Localforage instance for large background images that don't fit in localStorage
const bgStorage = browser
	? localforage.createInstance({ name: 'utsuwa-bg', storeName: 'assets' })
	: null;

/** localStorage key used by backgroundStore */
const BG_STORAGE_KEY = 'utsuwa-bg-v1';
/** localforage key for background images too large for localStorage */
const BG_CUSTOM_URL_KEY = 'custom-url';

export interface ExportOptions {
	/** Include custom VRM models (can be large) */
	includeVrmModels: boolean;
	/** Include custom VRMA animations */
	includeVrmAnimations: boolean;
	/** Include keepsakes / photo memories (can be large) */
	includeKeepsakes: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
	includeVrmModels: true,
	includeVrmAnimations: true,
	includeKeepsakes: true
};

export interface ExportedVrmModel {
	id: string;
	name: string;
	blob: string; // base64-encoded binary
	mimeType: string;
	previewUrl?: string; // base64 thumbnail
}

export interface ExportedVrmAnimation {
	id: string;
	name: string;
	blob: string; // base64-encoded binary
	mimeType: string;
	description?: string;
	llmEnabled?: boolean;
}

export interface ExportedKeepsake {
	record: KeepsakeRecord;
	blob: string; // base64-encoded binary
	mimeType: string;
}

export interface ExportedSettings {
	/** Raw localStorage values (JSON strings) for all utsuwa-* keys */
	localStorage: Record<string, string>;
	/** All utsuwa-module-* localStorage keys */
	moduleSettings: Record<string, string>;
	/** Custom VRM models (non-default), blobs encoded as base64 */
	vrmModels: ExportedVrmModel[];
	/** Custom VRMA animations, blobs encoded as base64 (v3.3+) */
	vrmAnimations?: ExportedVrmAnimation[];
	/** Keepsakes / photo memories (v3.3+) */
	keepsakes?: ExportedKeepsake[];
	/** Per-avatar emotion expression mappings */
	expressionProfilesByModel: Record<string, Record<string, EmotionMapping>>;
	/** Theme preference (not prefixed with utsuwa-) */
	colorMode?: string;
	/** Active VRM model ID from localforage */
	activeModelId?: string;
	/** Large background image from localforage (too big for localStorage) */
	bgCustomUrlFromForage?: string;
}

// V3 SaveFile - includes settings + VRM models
export interface SaveFile {
	version: string;
	exportedAt: string;
	appVersion: string;
	data: {
		character: CharacterState;
		facts: Fact[];
		sessions: SessionSummary[];
		conversationTurns: ConversationTurn[];
		completedEvents: CompletedEventRecord[];
		/** v3.2+: structured fact library entries */
		factLibraryEntries?: FactLibraryEntry[];
		/** v3+: settings, module configs, VRM models */
		settings?: ExportedSettings;
	};
}

// Legacy V1 SaveFile for import compatibility
export interface LegacySaveFile {
	version: string;
	exportedAt: string;
	appVersion?: string;
	data: {
		characterStates?: Array<Record<string, unknown>>;
		companion?: Array<Record<string, unknown>>;
		facts: Array<Record<string, unknown>>;
		sessions: Array<Record<string, unknown>>;
		conversationTurns: Array<Record<string, unknown>>;
		completedEvents: Array<Record<string, unknown>>;
		personas?: Array<Record<string, unknown>>;
	};
}

export interface SaveFilePreview {
	version: string;
	exportedAt: Date;
	appVersion: string;
	counts: {
		facts: number;
		sessions: number;
		conversationTurns: number;
		completedEvents: number;
		factLibraryEntries?: number;
		vrmModels?: number;
		vrmAnimations?: number;
		keepsakes?: number;
		expressionProfiles?: number;
	};
	characterName: string;
	hasSettings: boolean;
}

export async function exportSave(options: Partial<ExportOptions> = {}): Promise<SaveFile> {
	const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };

	const [characterStates, facts, sessions, conversationTurns, completedEvents, factLibraryEntries] =
		await Promise.all([
			db.characterStates.toArray(),
			db.facts.toArray(),
			db.sessions.toArray(),
			db.conversationTurns.toArray(),
			db.completedEvents.toArray(),
			db.factLibrary.toArray()
		]);

	// Get the single character state (or use current store state)
	const characterState = characterStates[0] || $state.snapshot(characterStore.state);

	// Remove IndexedDB auto-increment ids and derived data (embeddings) from export
	const { id: _charId, ...cleanCharacter } = characterState as CharacterState & { id?: number };
	const cleanFacts = facts.map(({ id: _id, embedding: _embedding, ...rest }) => rest) as Fact[];
	const cleanSessions = sessions.map(({ id: _id, ...rest }) => rest) as SessionSummary[];
	const cleanTurns = conversationTurns.map(({ id: _id, ...rest }) => rest) as ConversationTurn[];
	const cleanEvents = completedEvents.map(
		({ id: _id, ...rest }) => rest
	) as CompletedEventRecord[];
	const cleanFactLibrary = factLibraryEntries.map(
		({ id: _id, embedding: _embedding, ...rest }) => rest
	) as FactLibraryEntry[];

	// Collect settings from localStorage and localforage
	const settings = await collectSettings(opts);

	return {
		version: SAVE_FILE_VERSION,
		exportedAt: new Date().toISOString(),
		appVersion: import.meta.env.VITE_APP_VERSION,
		data: {
			character: cleanCharacter as CharacterState,
			facts: cleanFacts,
			sessions: cleanSessions,
			conversationTurns: cleanTurns,
			completedEvents: cleanEvents,
			factLibraryEntries: cleanFactLibrary,
			settings
		}
	};
}

/** Estimate the size of each optional export category in bytes. */
export interface ExportSizeEstimate {
	vrmModels: number;
	vrmAnimations: number;
	keepsakes: number;
	total: number;
}

export async function estimateExportSizes(): Promise<ExportSizeEstimate> {
	let vrmModels = 0;
	let vrmAnimations = 0;
	let keepsakes = 0;

	if (vrmStorage) {
		try {
			const modelList = await vrmStorage.getItem<Array<{ id: string; name: string; isDefault?: boolean }>>('model-list');
			if (modelList) {
				for (const model of modelList.filter((m) => !m.isDefault)) {
					const blob = await vrmStorage.getItem<Blob>(`model-blob-${model.id}`);
					const preview = await vrmStorage.getItem<string>(`model-preview-${model.id}`);
					if (blob) vrmModels += blob.size;
					if (preview) vrmModels += preview.length * 0.75; // base64 ~ 3/4 binary size
				}
			}
		} catch {
			// ignore
		}
	}

	if (animationStorage) {
		try {
			const animList = await animationStorage.getItem<Array<{ id: string; name: string }>>('custom-animation-list');
			if (animList) {
				for (const anim of animList) {
					const blob = await animationStorage.getItem<Blob>(`animation-blob-${anim.id}`);
					if (blob) vrmAnimations += blob.size;
				}
			}
		} catch {
			// ignore
		}
	}

	if (keepsakeStorage) {
		try {
			const index = await keepsakeStorage.getItem<KeepsakeRecord[]>('keepsake-index');
			if (index) {
				for (const record of index) {
					const blob = await keepsakeStorage.getItem<Blob>(`keepsake-blob-${record.id}`);
					if (blob) keepsakes += blob.size;
					if (record.thumb) keepsakes += record.thumb.length * 0.75;
				}
			}
		} catch {
			// ignore
		}
	}

	return {
		vrmModels,
		vrmAnimations,
		keepsakes,
		total: vrmModels + vrmAnimations + keepsakes
	};
}

/** Collect all settings from localStorage and localforage */
async function collectSettings(options: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<ExportedSettings> {
	const localStorage_: Record<string, string> = {};
	const moduleSettings: Record<string, string> = {};

	if (browser) {
		// Dynamically collect all utsuwa-* keys from localStorage
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			const val = localStorage.getItem(key);
			if (val === null) continue;
			if (key.startsWith('utsuwa-module-')) {
				moduleSettings[key] = val;
			} else if (key.startsWith('utsuwa-')) {
				localStorage_[key] = val;
			}
		}

		// Always export background from in-memory store — the customUrl data: URL may be
		// too large for localStorage so persist() silently drops it; the store keeps it in RAM.
		const bgCustomUrl = backgroundStore.customUrl;
		const bgPresetId = backgroundStore.activePresetId;
		if (bgPresetId || bgCustomUrl) {
			localStorage_[BG_STORAGE_KEY] = JSON.stringify({ presetId: bgPresetId, customUrl: bgCustomUrl });
		}
	}

	// VRM custom models + blobs
	const vrmModels: ExportedVrmModel[] = [];
	let expressionProfilesByModel: Record<string, Record<string, EmotionMapping>> = {};
	let activeModelId: string | undefined;

	if (vrmStorage && options.includeVrmModels) {
		try {
			const modelList = await vrmStorage.getItem<Array<{ id: string; name: string; isDefault?: boolean }>>('model-list');
			if (modelList) {
				const customModels = modelList.filter((m) => !m.isDefault);
				for (const model of customModels) {
					const blob = await vrmStorage.getItem<Blob>(`model-blob-${model.id}`);
					const preview = await vrmStorage.getItem<string>(`model-preview-${model.id}`);
					if (blob) {
						const base64 = await blobToBase64(blob);
						vrmModels.push({
							id: model.id,
							name: model.name,
							blob: base64,
							mimeType: blob.type || 'model/vrm',
							previewUrl: preview ?? undefined
						});
					}
				}
			}

			const savedProfiles =
				await vrmStorage.getItem<Record<string, Record<string, EmotionMapping>>>(
					'expression-profiles-by-model'
				);
			if (savedProfiles && typeof savedProfiles === 'object') {
				expressionProfilesByModel = savedProfiles;
			}

			// Active model ID
			const savedActiveId = await vrmStorage.getItem<string>('active-model-id');
			if (savedActiveId) activeModelId = savedActiveId;
		} catch (e) {
			console.warn('Failed to export VRM models:', e);
		}
	}

	// Always export expression profiles (small) even if models are skipped,
	// so settings are not lost when the user toggles models off.
	if (vrmStorage && !options.includeVrmModels) {
		try {
			const savedProfiles =
				await vrmStorage.getItem<Record<string, Record<string, EmotionMapping>>>(
					'expression-profiles-by-model'
				);
			if (savedProfiles && typeof savedProfiles === 'object') {
				expressionProfilesByModel = savedProfiles;
			}
		} catch (e) {
			console.warn('Failed to export expression profiles:', e);
		}
	}

	// Custom VRMA animations
	const vrmAnimations: ExportedVrmAnimation[] = [];
	if (animationStorage && options.includeVrmAnimations) {
		try {
			const animList = await animationStorage.getItem<Array<{ id: string; name: string }>>('custom-animation-list');
			const metadata = await animationStorage.getItem<Record<string, { description?: string; llmEnabled?: boolean }>>('animation-metadata');
			if (animList) {
				for (const anim of animList) {
					const blob = await animationStorage.getItem<Blob>(`animation-blob-${anim.id}`);
					if (blob) {
						const meta = metadata?.[anim.id];
						vrmAnimations.push({
							id: anim.id,
							name: anim.name,
							blob: await blobToBase64(blob),
							mimeType: blob.type || 'application/octet-stream',
							description: meta?.description,
							llmEnabled: meta?.llmEnabled
						});
					}
				}
			}
		} catch (e) {
			console.warn('Failed to export VRM animations:', e);
		}
	}

	// Keepsakes / photo memories
	const keepsakes: ExportedKeepsake[] = [];
	if (keepsakeStorage && options.includeKeepsakes) {
		try {
			const index = await keepsakeStorage.getItem<KeepsakeRecord[]>('keepsake-index');
			if (index) {
				for (const record of index) {
					const blob = await keepsakeStorage.getItem<Blob>(`keepsake-blob-${record.id}`);
					if (blob) {
						keepsakes.push({
							record,
							blob: await blobToBase64(blob),
							mimeType: record.mimeType || blob.type || 'image/jpeg'
						});
					}
				}
			}
		} catch (e) {
			console.warn('Failed to export keepsakes:', e);
		}
	}

	// Background fallback from localforage
	let bgCustomUrlFromForage: string | undefined;
	if (bgStorage) {
		try {
			const url = await bgStorage.getItem<string>(BG_CUSTOM_URL_KEY);
			if (url) bgCustomUrlFromForage = url;
		} catch (e) {
			console.warn('Failed to export background from localforage:', e);
		}
	}

	const result: ExportedSettings = {
		localStorage: localStorage_,
		moduleSettings,
		vrmModels,
		expressionProfilesByModel,
		colorMode: browser ? localStorage.getItem('colorMode') ?? undefined : undefined,
		activeModelId,
		bgCustomUrlFromForage
	};

	if (options.includeVrmAnimations) result.vrmAnimations = vrmAnimations;
	if (options.includeKeepsakes) result.keepsakes = keepsakes;

	return result;
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve((reader.result as string).split(',')[1]);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

export async function importSave(
	saveFile: SaveFile | LegacySaveFile,
	mode: 'merge' | 'replace'
): Promise<{ imported: number; skipped: number }> {
	let imported = 0;
	let skipped = 0;

	const isV2orV3 = saveFile.version.startsWith('2.') || saveFile.version.startsWith('3.');

	if (mode === 'replace') {
		// Clear all existing data
		await Promise.all([
			db.characterStates.clear(),
			db.facts.clear(),
			db.sessions.clear(),
			db.conversationTurns.clear(),
			db.completedEvents.clear(),
			db.factLibrary.clear()
		]);
	}

	if (isV2orV3) {
		// V2/V3 format - single character
		const v2File = saveFile as SaveFile;

		const charWithDefaults = {
			...v2File.data.character,
			sessionCountSinceEvolution: ((v2File.data.character as unknown as Record<string, unknown>).sessionCountSinceEvolution as number) ?? 0,
			evolutionThreshold: ((v2File.data.character as unknown as Record<string, unknown>).evolutionThreshold as number) ?? 10
		};
		// Ensure personality has communicationAdaptations
		const personality = (charWithDefaults.personality as unknown as Record<string, unknown>) || undefined;
		if (personality && !Array.isArray(personality.communicationAdaptations)) {
			personality.communicationAdaptations = [];
		}

		if (mode === 'replace') {
			await db.characterStates.add(charWithDefaults as DBCharacterState);
			imported++;
		} else {
			// Merge mode - skip character if one exists
			const existing = await db.characterStates.toCollection().first();
			if (!existing) {
				await db.characterStates.add(charWithDefaults as DBCharacterState);
				imported++;
			} else {
				skipped++;
			}
		}

		// Import facts
		for (const fact of v2File.data.facts) {
			await db.facts.add(fact);
			imported++;
		}

		// Import sessions
		for (const session of v2File.data.sessions) {
			await db.sessions.add(session);
			imported++;
		}

		// Import conversation turns
		for (const turn of v2File.data.conversationTurns) {
			await db.conversationTurns.add(turn);
			imported++;
		}

		// Import completed events
		for (const event of v2File.data.completedEvents) {
			await db.completedEvents.add(event);
			imported++;
		}

		// Import fact library entries (v3.2+, gracefully skip if missing in older saves)
		const factLibraryEntries = (v2File.data as SaveFile['data']).factLibraryEntries;
		if (factLibraryEntries) {
			for (const entry of factLibraryEntries) {
				await db.factLibrary.add(entry);
				imported++;
			}
		}

		// V3+: restore settings
		if (saveFile.version.startsWith('3.') && v2File.data.settings) {
			await restoreSettings(v2File.data.settings, mode);
		}
	} else {
		// V1 format - migrate to single character
		const v1File = saveFile as LegacySaveFile;

		// Take the first character state and first persona, merge them
		const firstCharState = v1File.data.characterStates?.[0];
		const firstPersona = v1File.data.personas?.[0];

		if (firstCharState || firstPersona) {
			const existing = await db.characterStates.toCollection().first();
			if (!existing || mode === 'replace') {
				// Build merged character state
				const mergedState = {
					characterId: 'default',
					// Persona fields from persona or defaults
					name: (firstPersona?.name as string) || 'Utsuwa',
					systemPrompt:
						(firstPersona?.systemPrompt as string) ||
						'You are a friendly AI assistant named Utsuwa.',
					extensions: (firstPersona?.extensions as Record<string, unknown>) || {},
					// Character fields from state or defaults
					mood: (firstCharState?.mood as MoodState) || {
						primary: 'neutral' as const,
						intensity: 50,
						causes: []
					},
					energy: (firstCharState?.energy as number) ?? 100,
					affection: (firstCharState?.affection as number) ?? 0,
					trust: (firstCharState?.trust as number) ?? 0,
					intimacy: (firstCharState?.intimacy as number) ?? 0,
					comfort: (firstCharState?.comfort as number) ?? 0,
					respect: (firstCharState?.respect as number) ?? 0,
					appMode: 'dating_sim' as const,
					relationshipStage: (firstCharState?.relationshipStage as RelationshipStage) || 'stranger',
					personality: (firstCharState?.personality as PersonalityProfile) || {
						openness: 0,
						warmth: 20,
						assertiveness: -10,
						playfulness: 10,
						sensitivity: 20,
						likesTeasing: 0,
						prefersDirectness: -10,
						romanticStyle: 'slow_burn' as const,
						communicationAdaptations: []
					},
					lastInteraction: (firstCharState?.lastInteraction as Date | null) || null,
					firstMet: (firstCharState?.firstMet as Date) || new Date(),
					daysKnown: (firstCharState?.daysKnown as number) ?? 0,
					totalInteractions: (firstCharState?.totalInteractions as number) ?? 0,
					currentStreak: (firstCharState?.currentStreak as number) ?? 0,
					longestStreak: (firstCharState?.longestStreak as number) ?? 0,
					streakLastDate: (firstCharState?.streakLastDate as string | null) || null,
					completedEvents: (firstCharState?.completedEvents as string[]) || [],
					sessionCountSinceEvolution: 0,
					evolutionThreshold: 10,
					createdAt: (firstCharState?.createdAt as Date) || new Date(),
					updatedAt: new Date()
				};
				await db.characterStates.add(mergedState);
				imported++;
			} else {
				skipped++;
			}
		}

		// Import facts (cast from legacy format)
		for (const fact of v1File.data.facts) {
			await db.facts.add(fact as unknown as Fact);
			imported++;
		}

		// Import sessions (cast from legacy format)
		for (const session of v1File.data.sessions) {
			await db.sessions.add(session as unknown as SessionSummary);
			imported++;
		}

		// Import conversation turns (cast from legacy format)
		for (const turn of v1File.data.conversationTurns) {
			await db.conversationTurns.add(turn as unknown as ConversationTurn);
			imported++;
		}

		// Import completed events (cast from legacy format)
		for (const event of v1File.data.completedEvents) {
			await db.completedEvents.add(event as unknown as CompletedEventRecord);
			imported++;
		}
	}

	// Reload character store to pick up imported data
	await characterStore.loadState();

	return { imported, skipped };
}

/** Restore settings from an exported settings block */
async function restoreSettings(settings: ExportedSettings, mode: 'merge' | 'replace'): Promise<void> {
	if (!browser) return;

	if (mode === 'replace') {
		// Clear existing utsuwa-* localStorage keys
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith('utsuwa-')) keysToRemove.push(key);
		}
		keysToRemove.forEach((k) => localStorage.removeItem(k));
		localStorage.removeItem('colorMode');

		// Clear VRM storage
		if (vrmStorage) {
			await vrmStorage.clear();
		}
		// Clear animation storage
		if (animationStorage) {
			await animationStorage.clear();
		}
		// Clear keepsake storage
		if (keepsakeStorage) {
			await keepsakeStorage.clear();
		}
		// Clear background localforage
		if (bgStorage) {
			await bgStorage.clear();
		}
	}

	const existingProfiles =
		vrmStorage && mode === 'merge'
			? await vrmStorage.getItem<Record<string, Record<string, EmotionMapping>>>(
					'expression-profiles-by-model'
				)
			: {};

	// Restore all utsuwa-* localStorage keys (settings always overwrite in merge mode)
	for (const [key, value] of Object.entries(settings.localStorage)) {
		if (key === BG_STORAGE_KEY) {
			// Background may contain a large data: URL — handle gracefully
			try {
				localStorage.setItem(key, value);
			} catch {
				// localStorage quota exceeded: save customUrl to localforage, store preset only
				try {
					const parsed = JSON.parse(value) as { presetId?: string; customUrl?: string };
					if (parsed.customUrl && bgStorage) {
						await bgStorage.setItem(BG_CUSTOM_URL_KEY, parsed.customUrl);
					}
					localStorage.setItem(key, JSON.stringify({ presetId: parsed.presetId ?? 'dot-grid', customUrl: '' }));
				} catch {
					// ignore
				}
			}
		} else {
			localStorage.setItem(key, value);
		}
	}

	// Restore module settings (always overwrite)
	for (const [key, value] of Object.entries(settings.moduleSettings)) {
		localStorage.setItem(key, value);
	}

	// Restore theme
	if (settings.colorMode) {
		localStorage.setItem('colorMode', settings.colorMode);
	}

	// Restore VRM models
	if (vrmStorage && settings.vrmModels.length > 0) {
		const existingList = await vrmStorage.getItem<Array<{ id: string; name: string; isDefault?: boolean }>>('model-list') ?? [];
		const existingIds = new Set(existingList.map((m) => m.id));

		const newEntries: Array<{ id: string; name: string; isDefault: boolean }> = [];

		for (const model of settings.vrmModels) {
			if (mode === 'merge' && existingIds.has(model.id)) continue;

			// Decode base64 blob
			const binaryStr = atob(model.blob);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
			const blob = new Blob([bytes], { type: model.mimeType });

			await vrmStorage.setItem(`model-blob-${model.id}`, blob);
			if (model.previewUrl) {
				await vrmStorage.setItem(`model-preview-${model.id}`, model.previewUrl);
			}
			newEntries.push({ id: model.id, name: model.name, isDefault: false });
		}

		if (newEntries.length > 0) {
			const updatedList = mode === 'replace'
				? newEntries
				: [...existingList, ...newEntries];
			await vrmStorage.setItem('model-list', updatedList);
		}
	}

	// Restore active model ID
	if (vrmStorage && settings.activeModelId) {
		await vrmStorage.setItem('active-model-id', settings.activeModelId);
	}

	// Restore per-avatar expression mappings
	if (vrmStorage && settings.expressionProfilesByModel) {
		const incomingProfiles = settings.expressionProfilesByModel;
		const mergedProfiles =
			mode === 'replace'
				? incomingProfiles
				: { ...(existingProfiles ?? {}), ...incomingProfiles };
		await vrmStorage.setItem('expression-profiles-by-model', mergedProfiles);
	}

	// Restore VRM animations
	if (animationStorage && settings.vrmAnimations && settings.vrmAnimations.length > 0) {
		const existingList = await animationStorage.getItem<Array<{ id: string; name: string }>>('custom-animation-list') ?? [];
		const existingIds = new Set(existingList.map((a) => a.id));
		const existingMetadata = await animationStorage.getItem<Record<string, { description?: string; llmEnabled?: boolean }>>('animation-metadata') ?? {};

		const newEntries: Array<{ id: string; name: string }> = [];
		const newMetadata: Record<string, { description?: string; llmEnabled?: boolean }> = { ...existingMetadata };

		for (const anim of settings.vrmAnimations) {
			if (mode === 'merge' && existingIds.has(anim.id)) continue;

			const binaryStr = atob(anim.blob);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
			const blob = new Blob([bytes], { type: anim.mimeType });

			await animationStorage.setItem(`animation-blob-${anim.id}`, blob);
			newEntries.push({ id: anim.id, name: anim.name });
			if (anim.description !== undefined || anim.llmEnabled !== undefined) {
				newMetadata[anim.id] = {
					description: anim.description,
					llmEnabled: anim.llmEnabled
				};
			}
		}

		if (newEntries.length > 0) {
			const updatedList = mode === 'replace'
				? newEntries
				: [...existingList, ...newEntries];
			await animationStorage.setItem('custom-animation-list', updatedList);
		}

		await animationStorage.setItem('animation-metadata', newMetadata);
	}

	// Restore keepsakes
	if (keepsakeStorage && settings.keepsakes && settings.keepsakes.length > 0) {
		const existingList = await keepsakeStorage.getItem<KeepsakeRecord[]>('keepsake-index') ?? [];
		const existingIds = new Set(existingList.map((k) => k.id));

		const newEntries: KeepsakeRecord[] = [];

		for (const keepsake of settings.keepsakes) {
			if (mode === 'merge' && existingIds.has(keepsake.record.id)) continue;

			const binaryStr = atob(keepsake.blob);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
			const blob = new Blob([bytes], { type: keepsake.mimeType });

			await keepsakeStorage.setItem(`keepsake-blob-${keepsake.record.id}`, blob);
			newEntries.push(keepsake.record);
		}

		if (newEntries.length > 0) {
			const updatedList = mode === 'replace'
				? newEntries
				: [...existingList, ...newEntries];
			await keepsakeStorage.setItem('keepsake-index', updatedList);
		}
	}

	// Restore background from localforage
	if (bgStorage && settings.bgCustomUrlFromForage) {
		await bgStorage.setItem(BG_CUSTOM_URL_KEY, settings.bgCustomUrlFromForage);
	}
}

export function validateSaveFile(json: unknown): SaveFile | LegacySaveFile | null {
	if (!json || typeof json !== 'object') return null;

	const obj = json as Record<string, unknown>;

	// Check required fields
	if (typeof obj.version !== 'string') return null;
	if (typeof obj.exportedAt !== 'string') return null;
	if (!obj.data || typeof obj.data !== 'object') return null;

	const data = obj.data as Record<string, unknown>;

	// V3 format check (same required fields as V2, settings is optional)
	if (obj.version.toString().startsWith('3.')) {
		if (!data.character) return null;
		if (!Array.isArray(data.facts)) return null;
		if (!Array.isArray(data.sessions)) return null;
		if (!Array.isArray(data.conversationTurns)) return null;
		if (!Array.isArray(data.completedEvents)) return null;
		return json as SaveFile;
	}

	// V2 format check
	if (obj.version.toString().startsWith('2.')) {
		if (!data.character) return null;
		if (!Array.isArray(data.facts)) return null;
		if (!Array.isArray(data.sessions)) return null;
		if (!Array.isArray(data.conversationTurns)) return null;
		if (!Array.isArray(data.completedEvents)) return null;
		return json as SaveFile;
	}

	// V1 format check
	const v1RequiredArrays = ['facts', 'sessions', 'conversationTurns', 'completedEvents'];
	for (const key of v1RequiredArrays) {
		if (!Array.isArray(data[key])) return null;
	}

	return json as LegacySaveFile;
}

export function getSaveFilePreview(saveFile: SaveFile | LegacySaveFile): SaveFilePreview {
	const isV2orV3 = saveFile.version.startsWith('2.') || saveFile.version.startsWith('3.');

	let characterName = 'Utsuwa';
	if (isV2orV3) {
		const v2 = saveFile as SaveFile;
		characterName = v2.data.character?.name || 'Utsuwa';
	} else {
		const v1 = saveFile as LegacySaveFile;
		characterName = (v1.data.personas?.[0]?.name as string) || 'Utsuwa';
	}

	const v3Settings = (saveFile as SaveFile).data.settings;

	return {
		version: saveFile.version,
		exportedAt: new Date(saveFile.exportedAt),
		appVersion: saveFile.appVersion || 'unknown',
		counts: {
			facts: saveFile.data.facts?.length ?? 0,
			sessions: saveFile.data.sessions?.length ?? 0,
			conversationTurns: saveFile.data.conversationTurns?.length ?? 0,
			completedEvents: saveFile.data.completedEvents?.length ?? 0,
			factLibraryEntries: (saveFile as SaveFile).data.factLibraryEntries?.length,
			vrmModels: v3Settings?.vrmModels.length,
			vrmAnimations: v3Settings?.vrmAnimations?.length,
			keepsakes: v3Settings?.keepsakes?.length,
			expressionProfiles: v3Settings ? Object.keys(v3Settings.expressionProfilesByModel ?? {}).length : undefined
		},
		characterName,
		hasSettings: !!v3Settings
	};
}

export function downloadSaveFile(saveFile: SaveFile): void {
	const json = JSON.stringify(saveFile, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const date = new Date().toISOString().split('T')[0];
	const filename = `utsuwa-save-${date}.json`;

	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();

	URL.revokeObjectURL(url);
}

/**
 * Reset only memory data (facts, sessions, turns, events, fact library).
 * Keeps character profile, settings, VRM models, and expression mappings.
 * Useful for starting a "new game" with the same character and avatar.
 */
export async function resetMemory(): Promise<void> {
	await Promise.all([
		db.facts.clear(),
		db.sessions.clear(),
		db.conversationTurns.clear(),
		db.completedEvents.clear(),
		db.factLibrary.clear()
	]);
}

/**
 * Reset character state and memory, but keep settings and VRM models.
 * Useful when you want to start fresh with the same avatar and companion config.
 */
export async function resetCharacterData(): Promise<void> {
	await Promise.all([
		db.characterStates.clear(),
		db.facts.clear(),
		db.sessions.clear(),
		db.conversationTurns.clear(),
		db.completedEvents.clear(),
		db.factLibrary.clear()
	]);
}

export async function clearAllData(): Promise<void> {
	await Promise.all([
		db.characterStates.clear(),
		db.facts.clear(),
		db.sessions.clear(),
		db.conversationTurns.clear(),
		db.completedEvents.clear(),
		db.factLibrary.clear()
	]);

	// Clear settings from localStorage
	if (browser) {
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith('utsuwa-')) keysToRemove.push(key);
		}
		keysToRemove.forEach((k) => localStorage.removeItem(k));
		localStorage.removeItem('colorMode');
	}

	// Clear VRM storage
	if (vrmStorage) {
		await vrmStorage.clear();
	}

	// Clear animation storage
	if (animationStorage) {
		await animationStorage.clear();
	}

	// Clear keepsake storage
	if (keepsakeStorage) {
		await keepsakeStorage.clear();
	}

	// Clear large background image fallback from localforage
	if (bgStorage) {
		await bgStorage.clear();
	}
}

/**
 * Background store — manages the 3D scene background preset.
 * Persisted to localStorage under 'utsuwa-bg-v1'.
 */

export type BackgroundType = 'dotgrid' | 'solid' | 'gradient' | 'image';

export interface BackgroundPreset {
	id: string;
	label: string;
	emoji: string;
	type: BackgroundType;
	/** For solid type */
	color?: string;
	/** For gradient type (top → bottom) */
	colors?: string[];
	/** CSS background used for the preview swatch in the UI */
	preview: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
	{
		id: 'dot-grid',
		label: 'Studio Grid',
		emoji: '⬜',
		type: 'dotgrid',
		preview: 'radial-gradient(circle, #c8c8c8 1.5px, #f8f8f8 1.5px) 0 0 / 10px 10px'
	},
	{
		id: 'white',
		label: 'White',
		emoji: '☁️',
		type: 'solid',
		color: '#f5f5f5',
		preview: '#f5f5f5'
	},
	{
		id: 'charcoal',
		label: 'Dark Studio',
		emoji: '🌑',
		type: 'solid',
		color: '#1c1c1e',
		preview: '#1c1c1e'
	},
	{
		id: 'blush',
		label: 'Blush',
		emoji: '🌸',
		type: 'gradient',
		colors: ['#ffecd2', '#fcb69f'],
		preview: 'linear-gradient(160deg, #ffecd2, #fcb69f)'
	},
	{
		id: 'dusk',
		label: 'Dusk',
		emoji: '🌅',
		type: 'gradient',
		colors: ['#a8edea', '#fed6e3'],
		preview: 'linear-gradient(160deg, #a8edea, #fed6e3)'
	},
	{
		id: 'midnight',
		label: 'Midnight',
		emoji: '🌌',
		type: 'gradient',
		colors: ['#0f0c29', '#302b63'],
		preview: 'linear-gradient(160deg, #0f0c29, #302b63)'
	},
	{
		id: 'forest',
		label: 'Forest',
		emoji: '🌿',
		type: 'gradient',
		colors: ['#134e5e', '#71b280'],
		preview: 'linear-gradient(160deg, #134e5e, #71b280)'
	},
	{
		id: 'aurora',
		label: 'Aurora',
		emoji: '🔮',
		type: 'gradient',
		colors: ['#1a1a2e', '#16213e', '#0f3460'],
		preview: 'linear-gradient(160deg, #1a1a2e, #0f3460)'
	},
	{
		id: 'custom',
		label: 'Custom Image',
		emoji: '🖼️',
		type: 'image',
		preview: 'repeating-linear-gradient(45deg, #e8e8e8 0, #e8e8e8 10px, #fff 0, #fff 20px)'
	}
];

const STORAGE_KEY = 'utsuwa-bg-v1';
/** localforage instance for background images too large for localStorage */
const BG_FORAGE_NAME = 'utsuwa-bg';
const BG_CUSTOM_URL_KEY = 'custom-url';

function loadSaved(): { presetId: string; customUrl: string } {
	if (typeof window === 'undefined') return { presetId: 'dot-grid', customUrl: '' };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (typeof parsed === 'object' && parsed.presetId) return parsed;
		}
	} catch {}
	return { presetId: 'dot-grid', customUrl: '' };
}

const saved = loadSaved();
let activePresetId = $state(saved.presetId);
let customUrl = $state(saved.customUrl);

// If there's a localforage fallback for a large background image, load it asynchronously
if (typeof window !== 'undefined' && !saved.customUrl && saved.presetId === 'custom') {
	import('localforage').then(({ default: lf }) => {
		const store = lf.createInstance({ name: BG_FORAGE_NAME, storeName: 'assets' });
		store.getItem<string>(BG_CUSTOM_URL_KEY).then((url) => {
			if (url) customUrl = url;
		});
	});
}

function persist() {
	if (typeof window !== 'undefined') {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: activePresetId, customUrl }));
		} catch {
			// If localStorage is full (e.g. large base64 image), store without the image
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: activePresetId, customUrl: '' }));
				// Save image to localforage as fallback
				if (customUrl.startsWith('data:')) {
					import('localforage').then(({ default: lf }) => {
						const store = lf.createInstance({ name: BG_FORAGE_NAME, storeName: 'assets' });
						store.setItem(BG_CUSTOM_URL_KEY, customUrl);
					});
				}
			} catch {}
		}
	}
}

export const backgroundStore = {
	get activePresetId() {
		return activePresetId;
	},
	get customUrl() {
		return customUrl;
	},
	get activePreset(): BackgroundPreset {
		return BACKGROUND_PRESETS.find((p) => p.id === activePresetId) ?? BACKGROUND_PRESETS[0];
	},

	setPreset(id: string) {
		activePresetId = id;
		persist();
	},

	setCustomUrl(url: string) {
		customUrl = url;
		persist();
	}
};

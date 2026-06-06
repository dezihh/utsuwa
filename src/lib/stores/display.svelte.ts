import { browser } from '$app/environment';

const STORAGE_KEY = 'utsuwa-display';
const DEFAULT_CAMERA_DISTANCE = 2.0;

export type ChatDisplayMode = 'bubble' | 'sidebar' | 'both' | 'off';
export type SidebarPosition = 'left' | 'right';

function createDisplayStore() {
	let cameraDistance = $state(DEFAULT_CAMERA_DISTANCE);
	let chatDisplayMode = $state<ChatDisplayMode>('bubble');
	let sidebarPosition = $state<SidebarPosition>('right');
	let typingIndicatorDelayMs = $state(0);
	let waitToneEnabled = $state(false);

	if (browser) {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				cameraDistance = parsed.cameraDistance ?? DEFAULT_CAMERA_DISTANCE;
				chatDisplayMode = parsed.chatDisplayMode ?? 'bubble';
				sidebarPosition = parsed.sidebarPosition ?? 'right';
				typingIndicatorDelayMs = parsed.typingIndicatorDelayMs ?? 0;
				waitToneEnabled = parsed.waitToneEnabled ?? false;
			} catch (e) {
				console.error('Failed to load display settings:', e);
			}
		}
	}

	function save() {
		if (browser) {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ cameraDistance, chatDisplayMode, sidebarPosition, typingIndicatorDelayMs, waitToneEnabled })
			);
		}
	}

	function setCameraDistance(distance: number) {
		cameraDistance = Math.max(1.0, Math.min(4.0, distance));
		save();
	}

	function setChatDisplayMode(mode: ChatDisplayMode) {
		chatDisplayMode = mode;
		save();
	}

	function setSidebarPosition(pos: SidebarPosition) {
		sidebarPosition = pos;
		save();
	}

	function setTypingIndicatorDelayMs(ms: number) {
		typingIndicatorDelayMs = Math.max(0, ms);
		save();
	}

	function setWaitToneEnabled(enabled: boolean) {
		waitToneEnabled = enabled;
		save();
	}

	return {
		get cameraDistance() {
			return cameraDistance;
		},
		get chatDisplayMode() {
			return chatDisplayMode;
		},
		get sidebarPosition() {
			return sidebarPosition;
		},
		get typingIndicatorDelayMs() {
			return typingIndicatorDelayMs;
		},
		get waitToneEnabled() {
			return waitToneEnabled;
		},
		setCameraDistance,
		setChatDisplayMode,
		setSidebarPosition,
		setTypingIndicatorDelayMs,
		setWaitToneEnabled
	};
}

export const displayStore = createDisplayStore();

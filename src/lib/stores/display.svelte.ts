import { browser } from '$app/environment';

const STORAGE_KEY = 'utsuwa-display';
const DEFAULT_CAMERA_DISTANCE = 2.0;
const DEFAULT_CAMERA_OFFSET_X = 0;
const DEFAULT_CAMERA_OFFSET_Y = 0;

export type ChatDisplayMode = 'bubble' | 'sidebar' | 'both' | 'off';
export type SidebarPosition = 'left' | 'right';

function createDisplayStore() {
	let cameraDistance = $state(DEFAULT_CAMERA_DISTANCE);
	let cameraOffsetX = $state(DEFAULT_CAMERA_OFFSET_X);
	let cameraOffsetY = $state(DEFAULT_CAMERA_OFFSET_Y);
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
				cameraOffsetX = parsed.cameraOffsetX ?? DEFAULT_CAMERA_OFFSET_X;
				cameraOffsetY = parsed.cameraOffsetY ?? DEFAULT_CAMERA_OFFSET_Y;
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
				JSON.stringify({ cameraDistance, cameraOffsetX, cameraOffsetY, chatDisplayMode, sidebarPosition, typingIndicatorDelayMs, waitToneEnabled })
			);
		}
	}

	function setCameraDistance(distance: number) {
		cameraDistance = Math.max(1.0, Math.min(4.0, distance));
		save();
	}

	function setCameraOffsetX(x: number) {
		cameraOffsetX = Math.max(-2.0, Math.min(2.0, x));
		save();
	}

	function setCameraOffsetY(y: number) {
		cameraOffsetY = Math.max(-1.5, Math.min(1.5, y));
		save();
	}

	function resetCameraPosition() {
		cameraOffsetX = DEFAULT_CAMERA_OFFSET_X;
		cameraOffsetY = DEFAULT_CAMERA_OFFSET_Y;
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
		get cameraDistance() { return cameraDistance; },
		get cameraOffsetX() { return cameraOffsetX; },
		get cameraOffsetY() { return cameraOffsetY; },
		get chatDisplayMode() { return chatDisplayMode; },
		get sidebarPosition() { return sidebarPosition; },
		get typingIndicatorDelayMs() { return typingIndicatorDelayMs; },
		get waitToneEnabled() { return waitToneEnabled; },
		setCameraDistance,
		setCameraOffsetX,
		setCameraOffsetY,
		resetCameraPosition,
		setChatDisplayMode,
		setSidebarPosition,
		setTypingIndicatorDelayMs,
		setWaitToneEnabled
	};
}

export const displayStore = createDisplayStore();

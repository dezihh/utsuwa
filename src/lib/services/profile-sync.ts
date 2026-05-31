/**
 * Client-side profile sync service.
 * Communicates with /api/profile to save/load the full profile.
 */

import type { SaveFile } from '$lib/db/export';
import { exportSave, importSave } from '$lib/db/export';

export interface SyncStatus {
	enabled: boolean;
	pinSet: boolean;
	profileExists: boolean;
}

export async function getSyncStatus(): Promise<SyncStatus> {
	const res = await fetch('/api/profile?status');
	if (!res.ok) return { enabled: false, pinSet: false, profileExists: false };
	return res.json();
}

/** Push current state to server. If newPin is provided it replaces the current PIN. */
export async function pushProfile(pin: string, newPin?: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const saveFile = await exportSave();
		const params = new URLSearchParams({ pin });
		if (newPin) params.set('newPin', newPin);

		const res = await fetch(`/api/profile?${params}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(saveFile)
		});

		if (res.status === 401) return { ok: false, error: 'Invalid PIN' };
		if (!res.ok) return { ok: false, error: await res.text() };
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
	}
}

/** Pull profile from server and import it. */
export async function pullProfile(
	pin: string,
	mode: 'merge' | 'replace' = 'replace'
): Promise<{ ok: boolean; imported?: number; error?: string }> {
	try {
		const params = new URLSearchParams({ pin });
		const res = await fetch(`/api/profile?${params}`);

		if (res.status === 401) return { ok: false, error: 'Invalid PIN' };
		if (res.status === 404) return { ok: false, error: 'No profile found on server' };
		if (!res.ok) return { ok: false, error: await res.text() };

		const saveFile: SaveFile = await res.json();
		const result = await importSave(saveFile, mode);
		return { ok: true, imported: result.imported };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
	}
}

const SYNC_PIN_KEY = 'utsuwa-sync-pin-session';

/** Remember PIN for this session (sessionStorage, cleared on tab close) */
export function rememberPin(pin: string): void {
	sessionStorage.setItem(SYNC_PIN_KEY, pin);
}

export function getSessionPin(): string {
	return sessionStorage.getItem(SYNC_PIN_KEY) ?? '';
}

export function clearSessionPin(): void {
	sessionStorage.removeItem(SYNC_PIN_KEY);
}

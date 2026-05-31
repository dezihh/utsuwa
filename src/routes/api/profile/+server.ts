/**
 * /api/profile — server-side profile sync
 *
 * Only active when UTSUWA_PROFILE_SYNC_ENABLED=true in env.
 * Profile is stored as a JSON file at DATA_DIR/profile.json.
 * Protected by a PIN (bcrypt hash stored separately at DATA_DIR/profile-pin.hash).
 *
 * GET  /api/profile         — returns profile JSON (requires PIN header)
 * POST /api/profile         — saves profile JSON (requires PIN header or sets new PIN)
 * GET  /api/profile?status  — returns sync availability + whether a PIN is set (no auth)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import bcrypt from 'bcryptjs';

const SYNC_ENABLED = process.env.UTSUWA_PROFILE_SYNC_ENABLED === 'true';
const DATA_DIR = process.env.UTSUWA_DATA_DIR || '/data';
const PROFILE_PATH = join(DATA_DIR, 'profile.json');
const PIN_HASH_PATH = join(DATA_DIR, 'profile-pin.hash');

async function ensureDataDir(): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function validatePin(pin: string): Promise<boolean> {
	if (!(await fileExists(PIN_HASH_PATH))) return true; // no PIN set yet
	const stored = await readFile(PIN_HASH_PATH, 'utf8');
	return bcrypt.compare(pin.trim(), stored.trim());
}

async function hasPinSet(): Promise<boolean> {
	return fileExists(PIN_HASH_PATH);
}

export const GET: RequestHandler = async ({ url }) => {
	if (!SYNC_ENABLED) {
		return json({ enabled: false }, { status: 404 });
	}

	// Status check — no auth required
	if (url.searchParams.has('status')) {
		const pinSet = await hasPinSet();
		const profileExists = await fileExists(PROFILE_PATH);
		return json({ enabled: true, pinSet, profileExists });
	}

	// Load profile — requires PIN header
	const pin = url.searchParams.get('pin') ?? '';
	if (!(await validatePin(pin))) {
		return json({ error: 'Invalid PIN' }, { status: 401 });
	}

	if (!(await fileExists(PROFILE_PATH))) {
		return json({ error: 'No profile found' }, { status: 404 });
	}

	const content = await readFile(PROFILE_PATH, 'utf8');
	return new Response(content, {
		headers: { 'Content-Type': 'application/json' }
	});
};

export const POST: RequestHandler = async ({ request, url }) => {
	if (!SYNC_ENABLED) {
		return json({ error: 'Profile sync not enabled' }, { status: 404 });
	}

	const pin = url.searchParams.get('pin') ?? '';
	const newPin = url.searchParams.get('newPin') ?? '';

	// Validate existing PIN (if set)
	if (!(await validatePin(pin))) {
		return json({ error: 'Invalid PIN' }, { status: 401 });
	}

	await ensureDataDir();

	// Set new PIN if provided
	if (newPin) {
		const hash = await bcrypt.hash(newPin, 10);
		await writeFile(PIN_HASH_PATH, hash, 'utf8');
	}

	// Save profile
	const body = await request.text();
	await writeFile(PROFILE_PATH, body, 'utf8');

	return json({ ok: true, savedAt: new Date().toISOString() });
};

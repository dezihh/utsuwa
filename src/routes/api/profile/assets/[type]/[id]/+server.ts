/**
 * /api/profile/assets/[type]/[id] — binary asset storage for profile sync
 *
 * Handles VRM model files and custom background images.
 * Only active when UTSUWA_PROFILE_SYNC_ENABLED=true.
 *
 * GET  — download asset (requires PIN query param)
 * POST — upload asset binary (requires PIN query param)
 *
 * Assets stored at: DATA_DIR/assets/[type]/[id]
 */

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import bcrypt from 'bcryptjs';

const SYNC_ENABLED = process.env.UTSUWA_PROFILE_SYNC_ENABLED === 'true';
const DATA_DIR = process.env.UTSUWA_DATA_DIR || '/data';
const PIN_HASH_PATH = join(DATA_DIR, 'profile-pin.hash');

// Allowed asset types to prevent path traversal
const ALLOWED_TYPES = new Set(['vrm', 'background']);

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function validatePin(pin: string): Promise<boolean> {
	if (!(await fileExists(PIN_HASH_PATH))) return true;
	const stored = await readFile(PIN_HASH_PATH, 'utf8');
	return bcrypt.compare(pin.trim(), stored.trim());
}

function sanitizeSegment(s: string): string {
	// Allow only alphanumeric, hyphens, underscores, dots
	return s.replace(/[^a-zA-Z0-9_\-\.]/g, '');
}

export const GET: RequestHandler = async ({ params, url }) => {
	if (!SYNC_ENABLED) return json({ error: 'Not enabled' }, { status: 404 });

	const type = sanitizeSegment(params.type);
	const id = sanitizeSegment(params.id);
	if (!ALLOWED_TYPES.has(type) || !id) return json({ error: 'Invalid asset' }, { status: 400 });

	const pin = url.searchParams.get('pin') ?? '';
	if (!(await validatePin(pin))) return json({ error: 'Invalid PIN' }, { status: 401 });

	const assetPath = join(DATA_DIR, 'assets', type, id);
	if (!(await fileExists(assetPath))) return json({ error: 'Not found' }, { status: 404 });

	const data = await readFile(assetPath);
	const mimeType = type === 'vrm' ? 'model/vrm' : 'application/octet-stream';
	return new Response(data, { headers: { 'Content-Type': mimeType } });
};

export const POST: RequestHandler = async ({ params, url, request }) => {
	if (!SYNC_ENABLED) return json({ error: 'Not enabled' }, { status: 404 });

	const type = sanitizeSegment(params.type);
	const id = sanitizeSegment(params.id);
	if (!ALLOWED_TYPES.has(type) || !id) return json({ error: 'Invalid asset' }, { status: 400 });

	const pin = url.searchParams.get('pin') ?? '';
	if (!(await validatePin(pin))) return json({ error: 'Invalid PIN' }, { status: 401 });

	const assetDir = join(DATA_DIR, 'assets', type);
	await mkdir(assetDir, { recursive: true });

	const buffer = await request.arrayBuffer();
	await writeFile(join(assetDir, id), Buffer.from(buffer));

	return json({ ok: true });
};

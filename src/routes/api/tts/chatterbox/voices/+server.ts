import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CHATTERBOX_TIMEOUT_MS = 15000;

export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = (url.searchParams.get('baseUrl') ?? 'http://127.0.0.1:8300').replace(/\/$/, '');

	// Predefined voices are required; clone list is optional.
	let predefinedRes: Response;
	try {
		predefinedRes = await fetch(`${baseUrl}/get_predefined_voices`, {
			signal: AbortSignal.timeout(CHATTERBOX_TIMEOUT_MS)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Connection failed';
		return json({ error: `Cannot reach Chatterbox at ${baseUrl}: ${msg}` }, { status: 502 });
	}

	if (!predefinedRes.ok) {
		const body = await predefinedRes.text().catch(() => '');
		return json(
			{ error: `Cannot reach Chatterbox voices endpoint (upstream ${predefinedRes.status}). Check that Chatterbox is running and the base URL is correct (default: http://localhost:8300/).${body ? ' ' + body : ''}` },
			{ status: 502 }
		);
	}

	const predefined = (await predefinedRes.json()) as Array<{ display_name: string; filename: string }>;
	const predefinedVoices = predefined.map((v) => ({
		id: v.filename,
		name: v.display_name,
		type: 'predefined' as const
	}));

	// Clone/reference voices — non-fatal if endpoint fails or times out.
	let cloneVoices: Array<{ id: string; name: string; type: 'clone' }> = [];
	try {
		const clonesRes = await fetch(`${baseUrl}/get_reference_files`, {
			signal: AbortSignal.timeout(CHATTERBOX_TIMEOUT_MS)
		});
		if (clonesRes.ok) {
			const cloneFiles = (await clonesRes.json()) as string[];
			cloneVoices = cloneFiles.map((filename) => ({
				id: `clone:${filename}`,
				name: filename.replace(/\.(wav|mp3|flac|ogg)$/i, ''),
				type: 'clone' as const
			}));
		}
	} catch {
		// Keep predefined voices available even if clone endpoint is slow/unreachable.
	}

	return json({ voices: [...predefinedVoices, ...cloneVoices] });
};

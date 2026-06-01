import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = (url.searchParams.get('baseUrl') ?? 'http://127.0.0.1:8300').replace(/\/$/, '');

	// Fetch both predefined voices and clone reference files in parallel
	let predefinedRes: Response, clonesRes: Response;
	try {
		[predefinedRes, clonesRes] = await Promise.all([
			fetch(`${baseUrl}/get_predefined_voices`, { signal: AbortSignal.timeout(5000) }),
			fetch(`${baseUrl}/get_reference_files`, { signal: AbortSignal.timeout(5000) })
		]);
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

	// Clone/reference voices — non-fatal if endpoint fails
	let cloneVoices: Array<{ id: string; name: string; type: 'clone' }> = [];
	if (clonesRes.ok) {
		const cloneFiles = (await clonesRes.json()) as string[];
		cloneVoices = cloneFiles.map((filename) => ({
			id: `clone:${filename}`,
			name: filename.replace(/\.(wav|mp3|flac|ogg)$/i, ''),
			type: 'clone' as const
		}));
	}

	return json({ voices: [...predefinedVoices, ...cloneVoices] });
};


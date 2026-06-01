import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = (url.searchParams.get('baseUrl') ?? 'http://127.0.0.1:8300').replace(/\/$/, '');

	let response: Response;
	try {
		response = await fetch(`${baseUrl}/get_predefined_voices`, { signal: AbortSignal.timeout(5000) });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Connection failed';
		return json({ error: `Cannot reach Chatterbox at ${baseUrl}: ${msg}` }, { status: 502 });
	}

	if (!response.ok) {
		return json({ error: `Chatterbox error: ${response.status}` }, { status: response.status });
	}

	const data = (await response.json()) as Array<{ display_name: string; filename: string }>;
	const voices = data.map((v) => ({ id: v.filename, name: v.display_name }));
	return json({ voices });
};

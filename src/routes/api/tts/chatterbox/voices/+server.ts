import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { assertSafeProviderUrl } from '$lib/services/providers/url-guard';

interface ChatterboxVoice {
	id: string;
	filename: string;
	size_bytes: number;
	created_at: number;
	is_reference?: boolean;
}

interface ChatterboxVoicesResponse {
	voices: ChatterboxVoice[];
}

/**
 * Proxies Chatterbox-NG's `/api/voices` list.
 *
 * The Chatterbox container does not set CORS headers, so browser clients cannot
 * fetch voices directly. Reference voices (clones) are prefixed with `ref:` so
 * the stream endpoint can route them to `/app/reference_audio/`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = url.searchParams.get('baseUrl');
	if (!baseUrl) {
		return new Response(JSON.stringify({ error: 'baseUrl query parameter is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let voicesUrl: URL;
	try {
		const parsed = assertSafeProviderUrl(baseUrl, env.ALLOW_LOCAL_PROVIDER_HOSTS === 'true');
		voicesUrl = new URL('/api/voices', parsed);
	} catch (e) {
		return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid baseUrl' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const response = await fetch(voicesUrl.toString());
		if (!response.ok) {
			return new Response(
				JSON.stringify({ error: `Chatterbox-NG returned ${response.status}` }),
				{ status: 502, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const data = (await response.json()) as ChatterboxVoicesResponse;
		const voices = (data.voices ?? []).map((voice) => ({
			id: voice.is_reference ? `ref:${voice.id}` : voice.id,
			name: voice.id
		}));

		return new Response(JSON.stringify({ voices }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		return new Response(
			JSON.stringify({
				error: e instanceof Error ? e.message : 'Failed to fetch voices from Chatterbox-NG'
			}),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}
};

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = (
		url.searchParams.get('baseUrl')?.trim() || 'http://localhost:8766'
	).replace(/\/+$/, '');

	const upstream = `${baseUrl}/tts/voices`;

	try {
		const upstreamResponse = await fetch(upstream);
		if (!upstreamResponse.ok) {
			const message = await upstreamResponse.text().catch(() => '');
			return new Response(
				JSON.stringify({ error: `OmniVoice error: ${upstreamResponse.status} ${message}` }),
				{ status: 502, headers: { 'Content-Type': 'application/json' } }
			);
		}
		const data = await upstreamResponse.json();
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		return new Response(
			JSON.stringify({ error: `Cannot connect to OmniVoice at ${upstream}: ${err}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}
};

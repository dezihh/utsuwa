import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = (url.searchParams.get('baseUrl') || 'http://localhost:8766').replace(/\/+$/, '');

	let upstreamResponse: Response;
	try {
		upstreamResponse = await fetch(`${baseUrl}/tts/voices`);
	} catch (err) {
		return new Response(
			JSON.stringify({ error: `Cannot connect to OmniVoice at ${baseUrl}: ${err}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}

	if (!upstreamResponse.ok) {
		return new Response(
			JSON.stringify({ error: `OmniVoice voices error: ${upstreamResponse.status}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const data = await upstreamResponse.json();
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};

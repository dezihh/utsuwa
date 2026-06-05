import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body || typeof body !== 'object') {
		return new Response(JSON.stringify({ error: 'Invalid request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const text = typeof body.text === 'string' ? body.text : '';
	const voice = typeof body.voice === 'string' ? body.voice : undefined;
	const instruct = typeof body.instruct === 'string' ? body.instruct : undefined;
	const numStep = typeof body.numStep === 'number' ? body.numStep : 32;
	const speed = typeof body.speed === 'number' ? body.speed : undefined;
	const language = typeof body.language === 'string' ? body.language : undefined;
	const baseUrl = (
		typeof body.baseUrl === 'string' && body.baseUrl.trim()
			? body.baseUrl.trim()
			: 'http://localhost:8766'
	).replace(/\/+$/, '');

	if (!text) {
		return new Response(JSON.stringify({ error: 'Text is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const upstream = `${baseUrl}/tts/stream`;

	let upstreamResponse: Response;
	try {
		upstreamResponse = await fetch(upstream, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text,
				// instruct → OmniVoice design mode (text descriptor); voice → clone mode
				...(instruct !== undefined ? { instruct } : { voice: voice || 'female3' }),
				num_step: numStep,
				...(speed !== undefined ? { speed } : {}),
				...(language !== undefined ? { language } : {})
			})
		});
	} catch (err) {
		return new Response(
			JSON.stringify({ error: `Cannot connect to OmniVoice at ${upstream}: ${err}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}

	if (!upstreamResponse.ok) {
		const message = await upstreamResponse.text().catch(() => '');
		return new Response(
			JSON.stringify({ error: `OmniVoice error: ${upstreamResponse.status} ${message}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}

	return new Response(upstreamResponse.body, {
		status: 200,
		headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }
	});
};

import type { RequestHandler } from './$types';

function normalizeBaseUrl(baseUrl: string): string {
	const clean = baseUrl.trim().replace(/\/+$/, '');
	return `${clean}/`;
}

function buildRequestBody(input: {
	text: string;
	voice?: string;
	speed?: number;
	exaggeration?: number;
	emotion?: string;
	language?: string;
	cfgWeight?: number;
	temperature?: number;
}) {
	// stream:true tells Chatterbox to yield audio as each chunk is synthesized
	const body: Record<string, unknown> = {
		text: input.text,
		voice_mode: 'predefined',
		stream: true,
		split_text: true
	};

	if (input.voice) body.predefined_voice_id = input.voice;
	if (typeof input.speed === 'number') body.speed_factor = input.speed;
	if (typeof input.exaggeration === 'number') body.exaggeration = input.exaggeration;
	if (input.language) body.language = input.language;
	if (typeof input.cfgWeight === 'number') body.cfg_weight = input.cfgWeight;
	if (typeof input.temperature === 'number') body.temperature = input.temperature;

	return body;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	const body = await request.json().catch(() => null);

	if (!body || typeof body !== 'object') {
		return new Response(JSON.stringify({ error: 'Invalid request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const text = typeof body.text === 'string' ? body.text : '';
	const voice = typeof body.voice === 'string' ? body.voice : '';
	const speed = typeof body.speed === 'number' ? body.speed : undefined;
	const exaggeration = typeof body.exaggeration === 'number' ? body.exaggeration : undefined;
	const emotion = typeof body.emotion === 'string' ? body.emotion : undefined;
	const language = typeof body.language === 'string' ? body.language : undefined;
	const cfgWeight = typeof body.cfgWeight === 'number' ? body.cfgWeight : undefined;
	const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
	const baseUrl =
		typeof body.baseUrl === 'string' && body.baseUrl.trim()
			? normalizeBaseUrl(body.baseUrl)
			: 'http://localhost:8300/';

	if (!text) {
		return new Response(JSON.stringify({ error: 'Text is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let upstream: Response;
	try {
		upstream = await fetch(new URL('tts', baseUrl), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(buildRequestBody({ text, voice, speed, exaggeration, emotion, language, cfgWeight, temperature }))
		});
	} catch (error) {
		return new Response(
			JSON.stringify({
				error: `Chatterbox request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			}),
			{
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	if (!upstream.ok) {
		const message = await upstream.text().catch(() => '');
		let hint = '';
		if (upstream.status === 404) hint = ' — the selected voice was not found. Please re-select a voice in Settings → Persona.';
		return new Response(JSON.stringify({ error: `Chatterbox stream error: ${upstream.status} ${message}${hint}` }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!upstream.body) {
		return new Response(JSON.stringify({ error: 'Chatterbox stream returned no body' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	return new Response(upstream.body, {
		status: 200,
		headers: {
			'Content-Type': upstream.headers.get('content-type') || 'audio/wav',
			'Cache-Control': 'no-store'
		}
	});
};

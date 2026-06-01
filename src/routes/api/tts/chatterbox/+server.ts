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
}) {
	const body: Record<string, unknown> = {
		model: 'chatterbox',
		input: input.text,
		response_format: 'wav'
	};

	if (input.voice) body.voice = input.voice;
	if (typeof input.speed === 'number') body.speed = input.speed;
	if (typeof input.exaggeration === 'number') body.exaggeration = input.exaggeration;
	if (input.emotion) body.emotion = input.emotion;
	if (input.language) body.language = input.language;

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
		upstream = await fetch(new URL('v1/audio/speech', baseUrl), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(buildRequestBody({ text, voice, speed, exaggeration, emotion, language }))
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
		return new Response(JSON.stringify({ error: `Chatterbox TTS error: ${upstream.status} ${message}` }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const contentType = upstream.headers.get('content-type') || 'audio/wav';
	return new Response(upstream.body, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'no-store'
		}
	});
};

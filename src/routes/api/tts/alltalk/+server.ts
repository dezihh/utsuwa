import type { RequestHandler } from './$types';

function normalizeBaseUrl(baseUrl: string): string {
	const clean = baseUrl.replace(/\/+$/, '');
	if (clean.endsWith('/api')) return `${clean}/`;
	if (clean.endsWith('/api/')) return clean;
	return `${clean}/api/`;
}

function normalizeAudioBaseUrl(baseUrl: string): string {
	return normalizeBaseUrl(baseUrl).replace(/\/api\/$/, '/');
}

function createOutputFileName(): string {
	const suffix = Math.random().toString(36).slice(2, 8);
	return `utsuwa_${Date.now()}_${suffix}.wav`;
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
	const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim()
		? body.baseUrl.trim()
		: 'http://localhost:7851/api/';
	const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'de';

	if (!text || !voice) {
		return new Response(JSON.stringify({ error: 'Text and voice are required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const outputFile = createOutputFileName();
	const form = new URLSearchParams({
		text,
		voice,
		language,
		output_file: outputFile
	});

	let generateResponse: Response;

	try {
		generateResponse = await fetch(new URL('tts-generate-streaming', normalizeBaseUrl(baseUrl)), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: form.toString()
		});
	} catch (error) {
		return new Response(
			JSON.stringify({
				error: `AllTalk request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			}),
			{
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	if (!generateResponse.ok) {
		const message = await generateResponse.text();
		return new Response(JSON.stringify({ error: `AllTalk TTS error: ${generateResponse.status} ${message}` }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const contentType = generateResponse.headers.get('content-type') || '';
	let audioResponse = generateResponse;

	if (contentType.includes('application/json')) {
		const payload = await generateResponse.json();
		const generatedFile =
			typeof payload?.output_file_path === 'string'
				? payload.output_file_path
				: typeof payload?.output_file === 'string'
					? payload.output_file
					: outputFile;

		const audioUrl = new URL(`audio/${generatedFile.replace(/^\/+/, '')}`, normalizeAudioBaseUrl(baseUrl));
		audioResponse = await fetch(audioUrl);

		if (!audioResponse.ok) {
			const message = await audioResponse.text();
			return new Response(JSON.stringify({ error: `AllTalk audio fetch error: ${audioResponse.status} ${message}` }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	const arrayBuffer = await audioResponse.arrayBuffer();
	return new Response(arrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': audioResponse.headers.get('content-type') || 'audio/x-wav'
		}
	});
};

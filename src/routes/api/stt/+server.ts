import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_WHISPER_BASE_URL = 'http://localhost:8000/v1';
const DEFAULT_MODEL = 'Systran/faster-whisper-large-v3';

export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Invalid multipart form data' }, { status: 400 });
	}

	const audioFile = formData.get('file') as File | null;
	if (!audioFile) {
		return json({ error: 'No audio file provided' }, { status: 400 });
	}

	const baseUrl = (formData.get('baseUrl') as string | null)?.replace(/\/$/, '') ?? DEFAULT_WHISPER_BASE_URL;
	const model = (formData.get('model') as string | null) ?? DEFAULT_MODEL;

	const whisperForm = new FormData();
	whisperForm.append('file', audioFile);
	whisperForm.append('model', model);
	whisperForm.append('response_format', 'json');

	const endpoint = `${baseUrl}/audio/transcriptions`;

	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			body: whisperForm
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Could not reach Whisper server';
		return json(
			{ error: `Could not reach Whisper at ${baseUrl}. Make sure the server is running. (${msg})` },
			{ status: 502 }
		);
	}

	if (!response.ok) {
		const body = await response.text();
		return json({ error: `Whisper error (${response.status}): ${body}` }, { status: response.status });
	}

	const data = (await response.json()) as { text?: string };
	return json({ text: data.text ?? '' });
};

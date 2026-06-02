import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_WHISPER_BASE_URL = 'http://127.0.0.1:8000/v1';
const DEFAULT_MODEL = 'deepdml/faster-whisper-large-v3-turbo-ct2';

function normalizeBaseUrl(value: FormDataEntryValue | null): string {
	if (typeof value !== 'string') return DEFAULT_WHISPER_BASE_URL;

	const trimmed = value.trim().replace(/\/$/, '');
	return trimmed || DEFAULT_WHISPER_BASE_URL;
}

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

	const baseUrl = normalizeBaseUrl(formData.get('baseUrl'));
	const model = ((formData.get('model') as string | null) ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

	// Convert File to Blob for proper multipart transmission to upstream server
	const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type || 'audio/wav' });

	const whisperForm = new FormData();
	whisperForm.append('file', audioBlob, audioFile.name);
	whisperForm.append('model', model);
	whisperForm.append('response_format', 'json');

	let endpoint: string;
	try {
		endpoint = new URL('audio/transcriptions', `${baseUrl}/`).toString();
	} catch {
		return json(
			{ error: `Invalid Whisper base URL: ${baseUrl}` },
			{ status: 400 }
		);
	}

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

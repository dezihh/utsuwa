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

	let audioFile: File;
	try {
		const file = formData.get('file');
		if (!(file instanceof File)) {
			return json({ error: 'No audio file provided' }, { status: 400 });
		}
		audioFile = file;

		// Ensure we can read the file (size > 0)
		if (audioFile.size === 0) {
			return json({ error: 'Audio file is empty' }, { status: 400 });
		}

		// Accept any audio format — the upstream whisper server handles conversion via ffmpeg
		if (!audioFile.type.startsWith('audio/') && !audioFile.name.toLowerCase().match(/\.(wav|webm|ogg|mp3|m4a|flac)$/)) {
			return json({ error: 'Audio file required' }, { status: 400 });
		}
	} catch (err) {
		return json({ error: 'Failed to process audio file: ' + (err instanceof Error ? err.message : String(err)) }, { status: 400 });
	}

	const baseUrl = normalizeBaseUrl(formData.get('baseUrl'));
	const model = ((formData.get('model') as string | null) ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

	// Convert File to Blob for proper multipart transmission to upstream server
	const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type || 'audio/wav' });

	const whisperForm = new FormData();
	whisperForm.append('file', audioBlob, audioFile.name);
	whisperForm.append('model', model);
	whisperForm.append('response_format', 'verbose_json');

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

	const data = (await response.json()) as {
		text?: string;
		no_speech_prob?: number;
		segments?: Array<{ avg_logprob?: number; no_speech_prob?: number }>;
	};

	// Quality filters: discard likely hallucinations produced by faster-whisper.
	//
	// no_speech_prob > 0.6  → Whisper itself doubts there was any speech in the audio.
	//                         Typical cause: silence, background noise, TTS echo.
	//
	// avg_logprob < -1.0    → Very low token-level confidence. Typical cause: mismatched
	//                         language ("Icelandic hallucination"), garbled audio, or
	//                         microphone picking up non-speech sounds.
	//
	// Both thresholds are permissive enough not to affect normal bilingual speech
	// (e.g. Spanish vocabulary mixed into German conversation).
	const noSpeechProb = data.no_speech_prob ?? 0;
	const firstSegLogprob = data.segments?.[0]?.avg_logprob ?? 0;
	const hasSegments = Array.isArray(data.segments) && data.segments.length > 0;
	if (noSpeechProb > 0.6 || (hasSegments && firstSegLogprob < -1.0)) {
		return json({ text: '' });
	}

	let transcription = data.text ?? '';
	// If the transcription contains no alphanumeric characters (in any script), treat it as empty.
	// Use more inclusive pattern that allows German umlauts and other diacritics.
	if (!/[\p{Letter}\p{Number}]/u.test(transcription)) {
		transcription = '';
	}
	return json({ text: transcription });
};

import type { RequestHandler } from './$types';

const SILENCE_PADDING_MS = 800;

/**
 * Append silence to the end of a PCM WAV buffer.
 * Reads the fmt chunk to determine sample rate / channels / bit depth,
 * then extends the data chunk with the requested amount of silence.
 */
function padWavWithSilence(input: ArrayBuffer, silenceMs: number): ArrayBuffer {
	const view = new DataView(input);
	const textDecoder = new TextDecoder('ascii');

	// Verify RIFF/WAVE header
	if (textDecoder.decode(new Uint8Array(input, 0, 4)) !== 'RIFF') return input;
	if (textDecoder.decode(new Uint8Array(input, 8, 4)) !== 'WAVE') return input;

	// Locate fmt and data chunks
	let offset = 12;
	let fmtOffset = -1;
	let dataOffset = -1;
	let dataSize = 0;

	while (offset + 8 <= input.byteLength) {
		const chunkId = textDecoder.decode(new Uint8Array(input, offset, 4));
		const chunkSize = view.getUint32(offset + 4, true);
		if (chunkId === 'fmt ') {
			fmtOffset = offset;
		} else if (chunkId === 'data') {
			dataOffset = offset;
			dataSize = chunkSize;
			break;
		}
		offset += 8 + chunkSize + (chunkSize % 2);
	}

	if (fmtOffset === -1 || dataOffset === -1 || dataOffset + 8 + dataSize > input.byteLength) {
		return input;
	}

	const channels = view.getUint16(fmtOffset + 10, true);
	const sampleRate = view.getUint32(fmtOffset + 12, true);
	const bitsPerSample = view.getUint16(fmtOffset + 22, true);
	const bytesPerSample = (bitsPerSample * channels) / 8;
	const silenceBytes = Math.floor((silenceMs / 1000) * sampleRate * bytesPerSample);

	const output = new ArrayBuffer(input.byteLength + silenceBytes);
	const outView = new DataView(output);
	const outBytes = new Uint8Array(output);
	const inBytes = new Uint8Array(input);

	// Copy entire original file
	outBytes.set(inBytes);

	// Fill silence at the end of the data chunk
	const silenceStart = dataOffset + 8 + dataSize;
	outBytes.fill(0, silenceStart, silenceStart + silenceBytes);

	// Update data chunk size
	outView.setUint32(dataOffset + 4, dataSize + silenceBytes, true);
	// Update RIFF chunk size
	outView.setUint32(4, output.byteLength - 8, true);

	return output;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body || typeof body !== 'object') {
		return new Response(JSON.stringify({ error: 'Invalid request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const text = typeof body.text === 'string' ? body.text : '';
	let voice = typeof body.voice === 'string' ? body.voice : undefined;
	let instruct = typeof body.instruct === 'string' ? body.instruct : undefined;
	const numStep = typeof body.numStep === 'number' ? body.numStep : 32;
	const speed = typeof body.speed === 'number' ? body.speed : undefined;
	const language = typeof body.language === 'string' ? body.language : undefined;
	const baseUrl = (
		typeof body.baseUrl === 'string' && body.baseUrl.trim()
			? body.baseUrl.trim()
			: 'http://localhost:8766'
	).replace(/\/+$/, '');

	// Allow callers to pass `voice: "instruct:<descriptor>"` as a single field
	if (voice !== undefined && voice.startsWith('instruct:')) {
		instruct = voice.slice('instruct:'.length);
		voice = undefined;
	}

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
				// Disable default silence trimming so final syllables don't get clipped.
				postprocess_output: false,
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

	const arrayBuffer = await upstreamResponse.arrayBuffer();
	const padded = padWavWithSilence(arrayBuffer, SILENCE_PADDING_MS);

	return new Response(padded, {
		status: 200,
		headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }
	});
};

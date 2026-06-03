import type { RequestHandler } from './$types';

const SAMPLE_RATE = 24000;
const NUM_CHANNELS = 1;
const WAV_HEADER_SIZE = 44;

/**
 * WAV audio format codes.
 * We use IEEE_FLOAT (3) so the Chatterbox float32 stream passes through unchanged.
 */
const WAV_FORMAT_IEEE_FLOAT = 3;

/** Map a UI voice ID to an absolute path inside the Chatterbox container. */
function voiceToPath(voice: string): string {
	if (voice.startsWith('clone:')) {
		return `/app/reference_audio/${voice.slice(6)}.wav`;
	}
	return `/app/voices/${voice}.wav`;
}

/**
 * Build a 44-byte WAV header for IEEE Float 32-bit mono audio.
 * Uses 0xFFFFFFFF as data size (streaming / unknown length).
 */
function makeFloat32WavHeader(): Uint8Array {
	const BITS_PER_SAMPLE = 32;
	const buf = new ArrayBuffer(WAV_HEADER_SIZE);
	const v = new DataView(buf);
	const byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
	const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

	v.setUint32(0, 0x52494646, false);          // 'RIFF'
	v.setUint32(4, 0xffffffff, true);            // file size (streaming, unknown)
	v.setUint32(8, 0x57415645, false);           // 'WAVE'
	v.setUint32(12, 0x666d7420, false);          // 'fmt '
	v.setUint32(16, 16, true);                   // fmt chunk size
	v.setUint16(20, WAV_FORMAT_IEEE_FLOAT, true);// audioFormat = 3 (IEEE Float)
	v.setUint16(22, NUM_CHANNELS, true);
	v.setUint32(24, SAMPLE_RATE, true);
	v.setUint32(28, byteRate, true);
	v.setUint16(32, blockAlign, true);
	v.setUint16(34, BITS_PER_SAMPLE, true);
	v.setUint32(36, 0x64617461, false);          // 'data'
	v.setUint32(40, 0xffffffff, true);           // data size (streaming, unknown)

	return new Uint8Array(buf);
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body || typeof body !== 'object') {
		return new Response(JSON.stringify({ error: 'Invalid request body' }), {
			status: 400, headers: { 'Content-Type': 'application/json' }
		});
	}

	const text = typeof body.text === 'string' ? body.text : '';
	const voice = typeof body.voice === 'string' ? body.voice : '';
	const baseUrl = (typeof body.baseUrl === 'string' && body.baseUrl.trim()
		? body.baseUrl.trim() : 'http://localhost:8765'
	).replace(/\/+$/, '');
	const exaggeration = typeof body.exaggeration === 'number' ? body.exaggeration : 0.4;
	const cfgWeight = typeof body.cfgWeight === 'number' ? body.cfgWeight : 0.5;
	const temperature = typeof body.temperature === 'number' ? body.temperature : 0.5;
	const language = typeof body.language === 'string' ? body.language : undefined;

	if (!text) {
		return new Response(JSON.stringify({ error: 'Text is required' }), {
			status: 400, headers: { 'Content-Type': 'application/json' }
		});
	}

	// Chatterbox only exposes a WebSocket endpoint — convert http(s) → ws(s).
	const wsUrl = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/tts';

	const wsParams: Record<string, unknown> = {
		text,
		output_sample_rate: SAMPLE_RATE,
		chunk_tokens: 100,
		sentence_pipelining: true,
		exaggeration,
		cfg_weight: cfgWeight,
		temperature,
	};
	if (voice) wsParams.audio_prompt_path = voiceToPath(voice);
	if (language) wsParams.language_id = language;

	// --- WebSocket setup ---
	// Set up all state and handlers before sending so no messages are missed.

	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	let closed = false;
	const closeWriter = () => {
		if (!closed) { closed = true; writer.close().catch(() => {}); }
	};

	let writeQueue = Promise.resolve();
	const enqueueWrite = (bytes: Uint8Array) => {
		writeQueue = writeQueue.then(() => writer.write(bytes)).catch(() => {});
	};

	type State = 'waiting' | 'streaming' | 'done';
	let state: State = 'waiting';
	let resolveWaiting!: () => void;
	let rejectWaiting!: (err: Error) => void;
	const waitingPromise = new Promise<void>((res, rej) => {
		resolveWaiting = res;
		rejectWaiting = rej;
	});

	let headerWritten = false;
	let ws: WebSocket;

	try {
		ws = new WebSocket(wsUrl);
	} catch {
		return new Response(JSON.stringify({ error: `Invalid Chatterbox URL: ${wsUrl}` }), {
			status: 502, headers: { 'Content-Type': 'application/json' }
		});
	}

	ws.binaryType = 'arraybuffer';

	ws.addEventListener('message', (event: MessageEvent) => {
		if (typeof event.data === 'string') {
			let msg: Record<string, unknown>;
			try { msg = JSON.parse(event.data as string); } catch { return; }

			if (msg.error && state === 'waiting') {
				rejectWaiting(new Error(String(msg.error)));
			} else if (msg.status === 'generating' && state === 'waiting') {
				state = 'streaming';
				resolveWaiting();
			} else if (msg.status === 'done') {
				state = 'done';
				writeQueue = writeQueue.then(closeWriter);
				ws.close();
			}
			return;
		}

		// Binary frame: raw float32-LE audio — forward directly, no conversion.
		if (state !== 'streaming') return;

		const bytes = new Uint8Array(event.data as ArrayBuffer);
		if (!headerWritten) {
			headerWritten = true;
			enqueueWrite(makeFloat32WavHeader());
		}
		enqueueWrite(bytes);
	});

	ws.addEventListener('error', () => {
		if (state === 'waiting') rejectWaiting(new Error(`Cannot connect to Chatterbox at ${wsUrl}`));
		closeWriter();
	});

	ws.addEventListener('close', () => {
		if (state === 'waiting') rejectWaiting(new Error('Chatterbox closed before sending status'));
		writeQueue = writeQueue.then(closeWriter);
	});

	// Wait for connection, then send params.
	try {
		await new Promise<void>((res, rej) => {
			ws.addEventListener('open', () => res(), { once: true });
			ws.addEventListener('error', () => rej(new Error(`Cannot connect to ${wsUrl}`)), { once: true });
		});
	} catch (err) {
		return new Response(
			JSON.stringify({ error: `Chatterbox request failed: ${err instanceof Error ? err.message : 'Unknown error'}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}

	ws.send(JSON.stringify(wsParams));

	// Wait for 'generating' — lets us return HTTP 502 on voice-not-found or param errors.
	try {
		await waitingPromise;
	} catch (err) {
		ws.close();
		return new Response(
			JSON.stringify({ error: `Chatterbox error: ${err instanceof Error ? err.message : 'Unknown error'}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}

	return new Response(readable, {
		status: 200,
		headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }
	});
};

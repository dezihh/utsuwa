export interface ChatterboxVoice {
	id: string;
	name: string;
}

export interface ChatterboxData {
	voices: ChatterboxVoice[];
	error?: string;
}

export async function fetchChatterboxVoices(baseUrl?: string): Promise<ChatterboxData> {
	const params = new URLSearchParams();
	if (baseUrl?.trim()) params.set('baseUrl', baseUrl.trim().replace(/\/$/, ''));

	try {
		const response = await fetch(`/api/tts/chatterbox/voices?${params}`, {
			signal: AbortSignal.timeout(6000)
		});
		const data = (await response.json()) as { voices?: ChatterboxVoice[]; error?: string };

		if (!response.ok || data.error) {
			return { voices: [], error: data.error ?? `Error ${response.status}` };
		}

		return { voices: data.voices ?? [] };
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Connection failed';
		return { voices: [], error: msg };
	}
}

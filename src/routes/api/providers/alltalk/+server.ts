import type { RequestHandler } from './$types';
import type { AllTalkData } from '$lib/services/providers/alltalk';

function ensureTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : url + '/';
}

function normalizeBaseUrl(baseUrl?: string): string {
	const clean = ensureTrailingSlash(baseUrl || 'http://localhost:7851/api/');
	const trimmed = clean.replace(/\/+$/, '');
	if (trimmed.endsWith('/api')) return `${trimmed}/`;
	if (trimmed.endsWith('/api/')) return trimmed;
	return `${trimmed}/api/`;
}

async function fetchJson(
	url: string,
	apiKey?: string,
	fetcher: typeof fetch = fetch
): Promise<unknown> {
	const response = await fetcher(url, {
		headers: {
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
		}
	});

	if (!response.ok) {
		throw new Error(`Request failed: ${response.status}`);
	}

	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function formatRequestError(result: unknown): string | null {
	if (!result || typeof result !== 'object' || !('error' in result)) return null;
	const error = (result as { error?: unknown }).error;
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	return error ? String(error) : 'Unknown error';
}

function normalizeOption(item: Record<string, unknown> | string) {
	if (typeof item === 'string') {
		const id = item.trim();
		if (!id) return null;
		return { id, name: id };
	}

	const id = String(item.id ?? item.voiceId ?? item.voice_id ?? item.name ?? item.voice ?? item.value ?? '').trim();
	if (!id) return null;
	const name = String(item.name ?? item.label ?? item.voice_name ?? item.display_name ?? id).trim();
	return { id, name: name || id };
}

function extractOptions(payload: unknown, keys: string[]) {
	if (Array.isArray(payload)) {
		return payload
			.map((item) =>
				typeof item === 'string' || (item && typeof item === 'object')
					? normalizeOption(item as Record<string, unknown> | string)
					: null
			)
			.filter(Boolean);
	}

	if (!payload || typeof payload !== 'object') return [];
	const record = payload as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value
				.map((item) =>
					typeof item === 'string' || (item && typeof item === 'object')
						? normalizeOption(item as Record<string, unknown> | string)
						: null
				)
				.filter(Boolean);
		}
	}
	return [];
}

function extractSettings(payload: unknown): Record<string, unknown> | null {
	return payload && typeof payload === 'object' && !Array.isArray(payload)
		? (payload as Record<string, unknown>)
		: null;
}

function pickDefault(settings: Record<string, unknown> | null, keys: string[]): string {
	if (!settings) return '';
	for (const key of keys) {
		const value = settings[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return '';
}

function parseReady(payload: unknown): boolean {
	if (typeof payload === 'boolean') return payload;
	if (typeof payload === 'string') {
		const value = payload.trim().toLowerCase();
		if (!value) return false;
		return value !== 'false' && value !== '0' && value !== 'error';
	}
	if (!payload || typeof payload !== 'object') return false;

	const record = payload as Record<string, unknown>;
	if ('error' in record) return false;
	for (const key of ['ready', 'isReady', 'success', 'ok']) {
		const value = record[key];
		if (typeof value === 'boolean') return value;
		if (typeof value === 'string') {
			const normalized = value.trim().toLowerCase();
			if (!normalized) continue;
			return normalized !== 'false' && normalized !== '0' && normalized !== 'error';
		}
	}

	return true;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const { baseUrl, apiKey } = await request.json();
		const effectiveBaseUrl = normalizeBaseUrl(baseUrl);

		const [readyResult, voicesResult, rvcVoicesResult, currentSettingsResult] = await Promise.all([
			fetchJson(`${effectiveBaseUrl}ready`, apiKey, fetch).catch((error) => ({ error })),
			fetchJson(`${effectiveBaseUrl}voices`, apiKey, fetch).catch((error) => ({ error })),
			fetchJson(`${effectiveBaseUrl}rvcvoices`, apiKey, fetch).catch((error) => ({ error })),
			fetchJson(`${effectiveBaseUrl}currentsettings`, apiKey, fetch).catch((error) => ({ error }))
		]);

		const currentSettings = extractSettings(currentSettingsResult);
		const requestErrors = [
			['ready', formatRequestError(readyResult)],
			['voices', formatRequestError(voicesResult)],
			['currentsettings', formatRequestError(currentSettingsResult)]
		]
			.filter(([, error]) => error)
			.map(([name, error]) => `${name}: ${error}`);
		const rvcError = formatRequestError(rvcVoicesResult);
		const rvcVoices = rvcError?.includes('404')
			? []
			: extractOptions(rvcVoicesResult, ['rvcvoices', 'rvcVoices', 'tvcvoices', 'tvcVoices', 'voices', 'data', 'result', 'items']);
		const response: AllTalkData = {
			ready: requestErrors.length === 0 && parseReady(readyResult),
			voices: extractOptions(voicesResult, ['voices', 'data', 'result', 'items']) as AllTalkData['voices'],
			rvcVoices: rvcVoices as AllTalkData['rvcVoices'],
			currentSettings,
			defaultVoiceId: pickDefault(currentSettings, ['voice', 'voiceId', 'voice_id', 'tts_voice', 'ttsVoice', 'default_voice']),
			defaultRvcVoiceId: pickDefault(currentSettings, ['rvcvoice', 'rvcVoice', 'rvc_voice', 'rvc_voice_id', 'tvc_voice', 'tvcVoice', 'default_rvc_voice']),
			error: requestErrors.length ? `AllTalk discovery failed (${requestErrors.join(', ')})` : undefined
		};

		return Response.json(response);
	} catch (error) {
		console.error('Error fetching AllTalk data:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return Response.json(
			{
				ready: false,
				voices: [],
				rvcVoices: [],
				currentSettings: null,
				defaultVoiceId: '',
				defaultRvcVoiceId: '',
				error: message
			} satisfies AllTalkData,
			{ status: 500 }
		);
	}
};

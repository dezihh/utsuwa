import { isTauri } from '$lib/services/platform';

export interface AllTalkOption {
	id: string;
	name: string;
}

export interface AllTalkData {
	ready: boolean;
	voices: AllTalkOption[];
	rvcVoices: AllTalkOption[];
	currentSettings: Record<string, unknown> | null;
	defaultVoiceId: string;
	defaultRvcVoiceId: string;
	error?: string;
}

const FETCH_TIMEOUT_MS = 10000;

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

function buildEndpoint(baseUrl: string, path: string): string {
	return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function normalizeOption(item: Record<string, unknown> | string): AllTalkOption | null {
	if (typeof item === 'string') {
		const id = item.trim();
		return id ? { id, name: id } : null;
	}

	const id = String(
		item.id ??
			item.voiceId ??
			item.voice_id ??
			item.name ??
			item.voice ??
			item.value ??
			''
	).trim();
	if (!id) return null;

	const name = String(
		item.name ??
			item.label ??
			item.voice_name ??
			item.display_name ??
			id
	).trim();

	return { id, name: name || id };
}

function extractOptions(payload: unknown, keys: string[]): AllTalkOption[] {
	if (Array.isArray(payload)) {
		return payload
			.map((item) =>
				typeof item === 'string' || (item && typeof item === 'object')
					? normalizeOption(item as Record<string, unknown> | string)
					: null
			)
			.filter((item): item is AllTalkOption => item !== null);
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
				.filter((item): item is AllTalkOption => item !== null);
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

async function fetchJson(url: string, apiKey?: string): Promise<unknown> {
	const response = await fetch(url, {
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

async function fetchAllTalkDataDirect(baseUrl?: string, apiKey?: string): Promise<AllTalkData> {
	const effectiveBaseUrl = normalizeBaseUrl(baseUrl);

	const [readyResult, voicesResult, rvcVoicesResult, currentSettingsResult] = await Promise.all([
		fetchJson(buildEndpoint(effectiveBaseUrl, 'ready'), apiKey).catch((error) => ({ error })),
		fetchJson(buildEndpoint(effectiveBaseUrl, 'voices'), apiKey).catch((error) => ({ error })),
		fetchJson(buildEndpoint(effectiveBaseUrl, 'rvcvoices'), apiKey).catch((error) => ({ error })),
		fetchJson(buildEndpoint(effectiveBaseUrl, 'currentsettings'), apiKey).catch((error) => ({ error }))
	]);

	const mandatoryErrors = [
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

	return {
		ready: mandatoryErrors.length === 0 && parseReady(readyResult),
		voices: extractOptions(voicesResult, ['voices', 'data', 'result', 'items']),
		rvcVoices,
		currentSettings: extractSettings(currentSettingsResult),
		defaultVoiceId: pickDefault(extractSettings(currentSettingsResult), [
			'voice',
			'voiceId',
			'voice_id',
			'tts_voice',
			'ttsVoice',
			'default_voice'
		]),
		defaultRvcVoiceId: pickDefault(extractSettings(currentSettingsResult), [
			'rvcvoice',
			'rvcVoice',
			'rvc_voice',
			'rvc_voice_id',
			'tvc_voice',
			'tvcVoice',
			'default_rvc_voice'
		]),
		error: mandatoryErrors.length ? `AllTalk discovery failed (${mandatoryErrors.join(', ')})` : undefined
	};
}

export async function fetchAllTalkData(baseUrl?: string, apiKey?: string): Promise<AllTalkData> {
	if (isTauri()) {
		return fetchAllTalkDataDirect(baseUrl, apiKey);
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch('/api/providers/alltalk', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ baseUrl, apiKey }),
			signal: controller.signal
		});

		const data = await response.json();
		if (data.error) {
			return { ready: false, voices: [], rvcVoices: [], currentSettings: null, defaultVoiceId: '', defaultRvcVoiceId: '', error: data.error };
		}

		return {
			ready: !!data.ready,
			voices: data.voices ?? [],
			rvcVoices: data.rvcVoices ?? [],
			currentSettings: data.currentSettings ?? null,
			defaultVoiceId: data.defaultVoiceId ?? '',
			defaultRvcVoiceId: data.defaultRvcVoiceId ?? ''
		};
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return { ready: false, voices: [], rvcVoices: [], currentSettings: null, defaultVoiceId: '', defaultRvcVoiceId: '', error: 'Request timed out' };
		}

		const message = error instanceof Error ? error.message : 'Failed to fetch AllTalk data';
		return { ready: false, voices: [], rvcVoices: [], currentSettings: null, defaultVoiceId: '', defaultRvcVoiceId: '', error: message };
	} finally {
		clearTimeout(timeout);
	}
}

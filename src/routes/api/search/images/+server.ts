/**
 * /api/search/images — server-side proxy for a SearXNG image search. The
 * target comes from `SEARXNG_URL` only (a query parameter would be an SSRF
 * vector), so the route is inert until an operator configures the instance.
 */
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { extractHostname, type ImageSearchResult } from '$lib/utils/image-search';

interface SearxImageRow {
	title?: string;
	url?: string;
	img_src?: string;
	source?: string;
}

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q) {
		return json({ error: 'Missing query parameter' }, 400);
	}

	const searxUrl = (env.SEARXNG_URL ?? '').trim();
	if (!searxUrl) {
		return json({ error: 'SearxNG URL not configured' }, 400);
	}

	try {
		const apiUrl = `${searxUrl.replace(/\/+$/, '')}/search?format=json&category_images=1&q=${encodeURIComponent(q)}`;
		const response = await fetch(apiUrl);
		if (!response.ok) {
			throw new Error(`SearxNG error: ${response.status} ${response.statusText}`);
		}
		const data = (await response.json()) as { results?: SearxImageRow[] };

		const results: ImageSearchResult[] = (data.results ?? [])
			.filter((row) => row.img_src || row.url)
			.slice(0, 12)
			.map((row) => ({
				title: row.title || 'Untitled',
				url: row.url || row.img_src || '',
				thumbnail: row.img_src || row.url || '',
				source: row.source || extractHostname(row.url || row.img_src || '')
			}));

		return json({ results, query: q });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, 500);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

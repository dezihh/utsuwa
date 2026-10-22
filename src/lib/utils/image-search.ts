/**
 * Shared types for the companion picture popup. The image URLs themselves ride
 * in the reply's JSON state block (`show_images` / `close_images`) and are
 * parsed by the response parser, so only the plain data shape lives here.
 */

export interface ImageSearchResult {
	title: string;
	url: string;
	thumbnail: string;
	source: string;
}

/** Hostname of a URL, or "unknown" when it cannot be parsed. */
export function extractHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return 'unknown';
	}
}

/** Build a `data:` URL from an image content block's MIME type and base64. */
export function toDataUrl(mimeType: string, base64: string): string {
	return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

// Keys that hold an image link in common search-tool result shapes.
const IMAGE_KEY_RE = /^(img|image|thumb|photo|picture)/i;
const IMAGE_URL_RE = /https?:\/\/[^\s"'<>\\]+\.(?:jpe?g|png|webp|gif|avif|bmp)(?:\?[^\s"'<>\\]*)?/gi;

/**
 * Pull direct image URLs out of a search tool result — JSON (img_src/thumbnail
 * fields) or plain text (any image-extension URL). De-duped, capped at 12.
 */
export function extractImageUrls(text: string): string[] {
	const found = new Set<string>();
	const add = (value: unknown) => {
		if (typeof value === 'string' && /^https?:\/\//i.test(value)) found.add(value.trim());
	};
	let data: unknown = null;
	try {
		data = JSON.parse(text);
	} catch {
		data = null;
	}
	if (data) {
		const walk = (node: unknown) => {
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			if (!node || typeof node !== 'object') return;
			for (const [key, value] of Object.entries(node)) {
				if (typeof value === 'string') {
					if (IMAGE_KEY_RE.test(key)) add(value);
				} else if (typeof value === 'object') {
					walk(value);
				}
			}
		};
		walk(data);
	}
	// Fallback: any URL ending in an image extension, whatever the JSON shape.
	for (const match of text.matchAll(IMAGE_URL_RE)) found.add(match[0]);
	return [...found].slice(0, 12);
}

// ── Choosing an image-search MCP tool ────────────────────────────────────────
// A search tool is any tool that takes a text query. File-fetch tools take a
// `url`, so they are naturally excluded.

export interface SearchToolLike {
	name: string;
	inputSchema?: { properties?: Record<string, unknown> };
}

const QUERY_KEYS = ['query', 'q', 'search', 'term', 'prompt'];

/** The parameter a tool uses for the search text, or null if it takes no query. */
export function queryArgKey(tool: SearchToolLike): string | null {
	const props = tool.inputSchema?.properties ?? {};
	return QUERY_KEYS.find((key) => key in props) ?? null;
}

/** Lower is a better image-search candidate; null means "not a query tool". */
export function searchToolRank(tool: SearchToolLike): number | null {
	if (!queryArgKey(tool)) return null;
	const name = tool.name.toLowerCase();
	if (name.includes('image') && name.includes('search')) return 0;
	if (name.includes('image')) return 1;
	if (name.includes('search')) return 2;
	return 3;
}

/** Pick the best query-taking MCP tool for image search, or undefined. */
export function pickSearchTool<T extends SearchToolLike>(tools: T[]): T | undefined {
	return tools
		.map((tool) => ({ tool, rank: searchToolRank(tool) }))
		.filter((entry): entry is { tool: T; rank: number } => entry.rank !== null)
		.sort((a, b) => a.rank - b.rank)[0]?.tool;
}

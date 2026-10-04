/**
 * Shared types for the companion image popup. Search intent itself is expressed
 * in the reply's JSON state block (`image_search` / `close_images`) and parsed
 * by the response parser, so only the plain data shape lives here.
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

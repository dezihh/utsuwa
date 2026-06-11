export interface ImageSearchResult {
	title: string
	url: string
	thumbnail: string
	source: string
}

export interface ParsedImageSearch {
	queries: string[]
	shouldClose: boolean
	cleanedText: string
}

export function extractImageSearchTags(text: string): ParsedImageSearch {
	const searchRegex = /\[search_image:([^\]]+)\]/gi
	const closeRegex = /\[close_images\]/gi

	const queries: string[] = []
	let match: RegExpExecArray | null

	while ((match = searchRegex.exec(text)) !== null) {
		const query = match[1].trim()
		if (query) {
			queries.push(query)
		}
	}

	const shouldClose = closeRegex.test(text)

	// Strip both tag types from text
	const cleanedText = text
		.replace(searchRegex, '')
		.replace(closeRegex, '')
		.trim()

	return { queries, shouldClose, cleanedText }
}

export async function searchImages(query: string, searxUrl: string): Promise<ImageSearchResult[]> {
	const url = `${searxUrl.replace(/\/+$/, '')}/search?format=json&category_images=1&q=${encodeURIComponent(query)}`
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`SearxNG error: ${response.status} ${response.statusText}`)
	}
	const data = (await response.json()) as {
		results?: Array<{
			title?: string
			url?: string
			img_src?: string
			source?: string
		}>
	}
	const results = (data.results || [])
		.filter((r) => r.img_src || r.url)
		.slice(0, 12)
		.map((r) => ({
			title: r.title || 'Untitled',
			url: r.url || r.img_src || '',
			thumbnail: r.img_src || r.url || '',
			source: r.source || extractHostname(r.url || r.img_src || '')
		}))
	return results
}

function extractHostname(url: string): string {
	try {
		return new URL(url).hostname
	} catch {
		return 'unknown'
	}
}

// ── Client-side fallback: parse natural-language image search requests ─────
// When the LLM refuses to use [search_image:...] tags, we detect the user's
// intent directly from their message and perform the search anyway.

const IMAGE_KEYWORDS = ['bild', 'bilder', 'foto', 'fotos', 'image', 'images', 'picture', 'pictures', 'photo', 'photos'];

export function tryExtractImageSearchFromUserMessage(text: string): string | null {
	const lower = text.toLowerCase();

	// Must contain an image keyword
	const hasImageKeyword = IMAGE_KEYWORDS.some((k) => lower.includes(k));
	if (!hasImageKeyword) return null;

	// Try to extract subject after a preposition (von/of/über/about/etc.)
	const afterPrep = text.match(/(?:von|of|über|about|zu|with|from|for|featuring)\s+(.+?)(?:\?|\.|!|$)/i);
	if (afterPrep && afterPrep[1]) {
		const query = afterPrep[1].trim();
		if (query.length > 1) return query;
	}

	// Fallback: strip all known filler words and return the rest
	let query = text
		.replace(/\b(?:zeig|zeige|show|suche|find|finde|gib|get|display|mir|me|doch|bitte|please|gerne|maybe|can\s+you|could\s+you|will\s+you|would\s+you|ein|some|paar|a\s+few|ein\s+paar|bilder?|fotos?|images?|pictures?|photos?|von|of|über|about|zu|with|from|for|featuring)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	query = query.replace(/[.!?]+$/, '').trim();

	if (query.length > 1) return query;
	return null;
}

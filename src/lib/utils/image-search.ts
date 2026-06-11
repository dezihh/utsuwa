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

const IMAGE_SEARCH_PATTERNS = [
	// German
	/(?:zeig|zeige|zeig\s+mir|zeige\s+mir|ich\s+will|ich\s+möchte)\s+(?:bitte\s+)?(?:gerne\s+)?(?:ein\s+)?(?:paar\s+)?(?:bilder?|fotos?|bilder|fotos)\s+(?:von|von\s+der|von\s+dem|von\s+einer|von\s+einem)?\s+(.+?)(?:\.|$)/i,
	/(?:zeig|zeige)\s+(?:mir\s+)?(?:bilder?|fotos?)\s+(?:von|von\s+der|von\s+dem)?\s+(.+?)(?:\.|$)/i,
	/(?:suche|finde)\s+(?:mir\s+)?(?:bilder?|fotos?)\s+(?:von|von\s+der|von\s+dem)?\s+(.+?)(?:\.|$)/i,
	/(?:zeig|zeige)\s+(?:mir\s+)?(?:was|etwas)\s+(?:von\s+)?(.+?)(?:\.|$)/i,
	// English
	/(?:show|show\s+me|display)\s+(?:me\s+)?(?:some\s+)?(?:images?|pictures?|photos?)\s+(?:of|from|about)?\s+(.+?)(?:\.|$)/i,
	/(?:search|find)\s+(?:for\s+)?(?:images?|pictures?|photos?)\s+(?:of|from|about)?\s+(.+?)(?:\.|$)/i,
	/(?:show|show\s+me)\s+(?:me\s+)?(?:something\s+)?(?:about|of|from)?\s+(.+?)(?:\.|$)/i
]

export function tryExtractImageSearchFromUserMessage(text: string): string | null {
	for (const pattern of IMAGE_SEARCH_PATTERNS) {
		const match = text.match(pattern)
		if (match && match[1]) {
			const query = match[1].trim()
			if (query.length > 1) {
				return query
			}
		}
	}
	return null
}

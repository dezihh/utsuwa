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

// ── Delayed image search: "Zeige mir in 2 Minuten Bilder von Rosen" ───────
// Detects image search requests with a time delay and returns query + trigger time.

const DELAYED_IMAGE_PATTERNS = [
	// German: "in/nach X [Zeit] ... bilder von ..."
	/(?:in|nach)\s+(\d[\d\s]*(?:minuten?|min|sekunden?|sek|stunden?|h)?)\b[\s\S]*?(?:bilder?|fotos?)\s+(?:von|von\s+der|von\s+dem|von\s+einer|von\s+einem)?\s+(.+?)(?:\.|!|\?|$)/i,
	// German: "zeige mir ... in X [Zeit]"
	/(?:zeig|zeige)\s+(?:mir\s+)?(?:bilder?|fotos?)\s+(?:von|von\s+der|von\s+dem)?\s+(.+?)\s+(?:in|nach)\s+(\d[\d\s]*(?:minuten?|min|sekunden?|sek|stunden?|h)?)(?:\.|!|\?|$)/i,
	// English: "show me images of ... in X [time]"
	/(?:show|show\s+me)\s+(?:me\s+)?(?:images?|pictures?|photos?)\s+(?:of|from|about)?\s+(.+?)\s+(?:in|after)\s+(\d[\d\s]*(?:minutes?|mins?|seconds?|secs?|hours?|h)?)(?:\.|!|\?|$)/i,
	// English: "in X [time] ... images of ..."
	/(?:in|after)\s+(\d[\d\s]*(?:minutes?|mins?|seconds?|secs?|hours?|h)?)\b[\s\S]*?(?:images?|pictures?|photos?)\s+(?:of|from|about)?\s+(.+?)(?:\.|!|\?|$)/i
]

function parseTimeToMs(timeStr: string): number {
	let totalMs = 0
	const hMatch = timeStr.match(/(\d+)\s*h(?:our)?s?/i)
	const mMatch = timeStr.match(/(\d+)\s*m(?:in)?/i)
	const sMatch = timeStr.match(/(\d+)\s*s(?:ec)?/i)
	if (hMatch) totalMs += parseInt(hMatch[1], 10) * 60 * 60 * 1000
	if (mMatch) totalMs += parseInt(mMatch[1], 10) * 60 * 1000
	if (sMatch) totalMs += parseInt(sMatch[1], 10) * 1000
	return totalMs
}

export function tryExtractDelayedImageSearch(text: string): { query: string; triggerAt: Date } | null {
	const lower = text.toLowerCase()
	const hasImageKeyword = IMAGE_KEYWORDS.some((k) => lower.includes(k))
	if (!hasImageKeyword) return null

	for (const pattern of DELAYED_IMAGE_PATTERNS) {
		const match = text.match(pattern)
		if (match) {
			const s = pattern.source
			const g1Time = s.startsWith('(?:in|nach)') || s.startsWith('(?:in|after)')
			const timeStr = (g1Time ? match[1] : match[2]).trim()
			const query = (g1Time ? match[2] : match[1]).trim()
			const totalMs = parseTimeToMs(timeStr)
			if (totalMs > 0 && query.length > 1) {
				return { query, triggerAt: new Date(Date.now() + totalMs) }
			}
		}
	}
	return null
}

// Generic fallback queries when the user asks for images but gives no specific subject
const GENERIC_IMAGE_QUERIES = [
	'beautiful scenery', 'cute animals', 'stunning landscape', 'amazing nature',
	'beautiful sunset', 'cute puppies', 'adorable kittens', 'beautiful flowers',
	'schöne landschaft', 'niedliche tiere', 'toller sonnenuntergang', 'süße katzen'
];

function pickGenericQuery(): string {
	return GENERIC_IMAGE_QUERIES[Math.floor(Math.random() * GENERIC_IMAGE_QUERIES.length)];
}

/**
 * Extract a search query from the user's message.
 * Returns a SPECIFIC query if the user mentions a subject (e.g. "Bilder von Katzen" → "Katzen").
 * Returns a GENERIC query if the user asks vaguely (e.g. "zeig mir ein Bild, das dir gefällt" → "beautiful scenery").
 * Returns null if no image intent is detected.
 */
export function tryExtractImageSearchFromUserMessage(text: string): string | null {
	const lower = text.toLowerCase();

	// Must contain an image keyword
	const hasImageKeyword = IMAGE_KEYWORDS.some((k) => lower.includes(k));
	if (!hasImageKeyword) return null;

	// 1. Try to extract specific subject after "von/of/from/about"
	const afterPrep = text.match(/(?:von|of|from|about|featuring)\s+([a-zA-ZäöüÄÖÜß\s]+?)(?:\?|\.|!|,|$)/i);
	if (afterPrep && afterPrep[1]) {
		const query = afterPrep[1].trim();
		// Only use if it's a short, concrete noun phrase (max 4 words)
		const words = query.split(/\s+/).filter((w) => w.length > 1);
		if (words.length >= 1 && words.length <= 4) {
			return query;
		}
	}

	// 2. Try to extract quoted text: "zeig mir Bilder von "Katzen"" → "Katzen"
	const quoted = text.match(/"([^"]{2,40})"/);
	if (quoted && quoted[1]) {
		return quoted[1].trim();
	}

	// 3. Vague request (no specific subject) → generic fallback
	// Detect vague patterns like "was dir gefällt", "etwas schönes", "irgendwas"
	const vaguePatterns = /(was dir gefällt|etwas schönes|irgendwas|irgendwelche|was schönes|something nice|anything|whatever you like)/i;
	if (vaguePatterns.test(text)) {
		return pickGenericQuery();
	}

	// 4. Last resort: try to strip filler words and see if anything concrete remains
	let stripped = text
		.replace(/\b(?:zeig|zeige|show|suche|find|finde|gib|get|display|mir|me|doch|bitte|please|gerne|maybe|can\s+you|could\s+you|will\s+you|would\s+you|ein|some|paar|a\s+few|ein\s+paar|bilder?|fotos?|images?|pictures?|photos?|von|of|über|about|zu|with|from|for|featuring|aus\s+dem\s+internet|from\s+the\s+internet)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	stripped = stripped.replace(/[.!?]+$/, '').trim();

	const strippedWords = stripped.split(/\s+/).filter((w) => w.length > 1);
	if (strippedWords.length >= 1 && strippedWords.length <= 4 && stripped.length > 2) {
		return stripped;
	}

	// 5. Nothing concrete found → generic fallback
	return pickGenericQuery();
}

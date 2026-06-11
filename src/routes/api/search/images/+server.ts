import type { RequestHandler } from './$types'
import type { ImageSearchResult } from '$lib/utils/image-search'

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')
	const searxUrl = url.searchParams.get('searxUrl') || ''

	if (!q) {
		return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	if (!searxUrl) {
		return new Response(JSON.stringify({ error: 'SearxNG URL not configured' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	try {
		const apiUrl = `${searxUrl.replace(/\/+$/, '')}/search?format=json&category_images=1&q=${encodeURIComponent(q)}`
		const response = await fetch(apiUrl)
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

		const results: ImageSearchResult[] = (data.results || [])
			.filter((r) => r.img_src || r.url)
			.slice(0, 12)
			.map((r) => ({
				title: r.title || 'Untitled',
				url: r.url || r.img_src || '',
				thumbnail: r.img_src || r.url || '',
				source: r.source || extractHostname(r.url || r.img_src || '')
			}))

		return new Response(JSON.stringify({ results, query: q }), {
			headers: { 'Content-Type': 'application/json' }
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		})
	}
}

function extractHostname(url: string): string {
	try {
		return new URL(url).hostname
	} catch {
		return 'unknown'
	}
}

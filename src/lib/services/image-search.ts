/**
 * Image search orchestration for the companion-driven popup.
 *
 * Search runs through the server route (SearXNG, `SEARXNG_URL`). Fetching an
 * individual picture runs through a configured MCP file-fetch tool so the app
 * can show it even when the source blocks hotlinking — the same tool also
 * yields the bytes a future vision pass would need. Both steps degrade
 * gracefully: no backend, no file-fetch tool, no picture.
 */
import { env as publicEnv } from '$env/dynamic/public';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { imageSearchStore } from '$lib/stores/image-search.svelte';
import { callTool } from '$lib/services/mcp/capability';
import { resolveVisionLLM, visionModelEnabled } from '$lib/services/llm/active-llm';
import { streamChat } from '$lib/services/llm/transport';
import { describeImagesRequest } from '$lib/services/chat/turn-context';
import { stripThinkingBlocks } from '$lib/services/tts/chat-text';
import type { McpToolImage } from '$lib/types/mcp';
import { toDataUrl, type ImageSearchResult } from '$lib/utils/image-search';

/** MCP tool name used to fetch a single image (the filefetcher server). */
export const IMAGE_FETCH_TOOL = 'fetch_file_from_url';

/** Largest edge requested from the file-fetch tool. */
const IMAGE_FETCH_MAX_DIMENSION = 1280;

/** True when a self-hosted image search backend is available to the app. */
export function isImageSearchEnabled(): boolean {
	const raw = (publicEnv.PUBLIC_IMAGE_SEARCH_ENABLED ?? '').trim().toLowerCase();
	return raw === 'true' || raw === '1' || raw === 'yes';
}

/** Run a SearXNG image search through the server proxy. Throws on failure. */
export async function searchImages(query: string): Promise<ImageSearchResult[]> {
	const res = await fetch(`/api/search/images?q=${encodeURIComponent(query)}`);
	const data = (await res.json().catch(() => null)) as
		| { results?: ImageSearchResult[]; error?: string }
		| null;
	if (!res.ok) {
		throw new Error(data?.error || `Image search failed (${res.status})`);
	}
	return data?.results ?? [];
}

/**
 * Fetch one image through an enabled MCP `fetch_file_from_url` tool. Returns
 * the base64 image block, or null when no such tool is configured or the call
 * fails. The bytes feed both the popup and a vision describe pass.
 */
export async function fetchImage(url: string): Promise<McpToolImage | null> {
	if (!url) return null;
	try {
		await mcpStore.ensureTools();
	} catch {
		// Discovery failure must not break the caller; fall back to the raw URL.
	}
	const tool = mcpStore.tools.find((entry) => entry.name === IMAGE_FETCH_TOOL);
	if (!tool) return null;
	const server = mcpStore.servers.find((entry) => entry.id === tool.serverId && entry.enabled);
	if (!server) return null;
	try {
		const result = await callTool(server, IMAGE_FETCH_TOOL, {
			url,
			max_dimension: IMAGE_FETCH_MAX_DIMENSION
		});
		return result.images?.[0] ?? null;
	} catch (err) {
		console.debug('[ImageSearch] file-fetch failed:', err);
		return null;
	}
}

/** Like `fetchImage`, but returns a `data:` URL (or null). */
export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
	const image = await fetchImage(url);
	return image ? toDataUrl(image.mimeType, image.data) : null;
}

/**
 * Open a result in a new tab. The picture is routed through the file-fetch tool
 * first (stable bytes, no hotlink block); without it the raw URL is opened.
 */
export async function openImageResult(url: string): Promise<void> {
	const dataUrl = await fetchImageAsDataUrl(url);
	if (dataUrl) {
		try {
			const blob = await (await fetch(dataUrl)).blob();
			window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
			return;
		} catch {
			// fall through to the raw URL
		}
	}
	window.open(url, '_blank', 'noopener,noreferrer');
}

// Latest describe call wins; an older in-flight call must not overwrite it.
let describeSeq = 0;

/**
 * Describe the picture currently in focus with the separate vision model, so
 * the companion can talk about what is actually on screen. No-op without a
 * vision model or a file-fetch tool. Safe to call on every focus change.
 */
export async function describeFocusedImage(): Promise<void> {
	if (!visionModelEnabled()) return;
	const query = imageSearchStore.currentQuery;
	const index = imageSearchStore.focusedIndex;
	const result = imageSearchStore.results[index];
	if (!result) return;
	const vision = resolveVisionLLM();
	if (!vision) return;

	const seq = ++describeSeq;
	const image = await fetchImage(result.thumbnail);
	if (!image || seq !== describeSeq) return;
	try {
		const request = describeImagesRequest(query, [{ mimeType: image.mimeType, base64: image.data }]);
		const description = await streamChat(
			{
				...vision,
				messages: [{ role: 'user', content: request.content }],
				systemPrompt: request.system,
				// Same drift guard as the user-photo vision path.
				...(vision.isLocal && { temperature: 0 })
			},
			() => {}
		);
		const clean = stripThinkingBlocks(description).trim();
		// Only apply when this is still the focused picture of the same search.
		if (
			seq !== describeSeq ||
			!clean ||
			!imageSearchStore.isOpen ||
			imageSearchStore.currentQuery !== query ||
			imageSearchStore.focusedIndex !== index
		) {
			return;
		}
		if (import.meta.env.DEV) {
			console.log('%c[ImageSearch] vision description', 'color:#a855f7;font-weight:bold', clean);
		}
		imageSearchStore.setDescription(clean);
	} catch (err) {
		console.debug('[ImageSearch] vision describe failed:', err);
	}
}

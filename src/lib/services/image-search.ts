/**
 * Companion picture display (hand-off).
 *
 * The model finds images with its own MCP search tools and lists the direct
 * image URLs in its reply (`show_images`); this module turns that list into the
 * popup. Fetching a picture's bytes runs through a configured MCP file-fetch
 * tool (`fetch_file_from_url`) so a hotlink-protected source still displays and
 * a vision model can look at it. Every step degrades gracefully.
 */
import { mcpStore } from '$lib/stores/mcp.svelte';
import { imageSearchStore } from '$lib/stores/image-search.svelte';
import { callTool } from '$lib/services/mcp/capability';
import { resolveVisionLLM, visionModelEnabled } from '$lib/services/llm/active-llm';
import { streamChat } from '$lib/services/llm/transport';
import { describeImagesRequest } from '$lib/services/chat/turn-context';
import { stripThinkingBlocks } from '$lib/services/tts/chat-text';
import type { McpTool, McpToolImage } from '$lib/types/mcp';
import { extractHostname, extractImageUrls, pickSearchTool, queryArgKey, toDataUrl, type ImageSearchResult } from '$lib/utils/image-search';

/** MCP tool name used to fetch a single image (the filefetcher server). */
export const IMAGE_FETCH_TOOL = 'fetch_file_from_url';

/** Largest edge requested from the file-fetch tool. */
const IMAGE_FETCH_MAX_DIMENSION = 1280;

/** True when MCP is available, so the companion can find and show pictures. */
export function isShowImagesEnabled(): boolean {
	return mcpStore.serverEnabled && mcpStore.enabledServers.length > 0;
}

/** Build popup results from the direct image URLs the model handed over. */
export function showImages(urls: string[]): void {
	const results: ImageSearchResult[] = urls.map((url) => ({
		title: extractHostname(url),
		url,
		thumbnail: url,
		source: extractHostname(url)
	}));
	imageSearchStore.openModal(results, '');
	if (results.length > 0) void describeFocusedImage();
}

// ── App-driven fallback: resolve a query through an enabled MCP search tool ──
// Used when the model only gave a query (image_search) instead of direct URLs.
// Any query-taking search MCP works; the tool's declared parameters decide how.

function buildSearchArgs(tool: McpTool, query: string): Record<string, unknown> {
	const props = tool.inputSchema?.properties ?? {};
	const args: Record<string, unknown> = {};
	args[queryArgKey(tool) ?? 'query'] = query;
	if ('categories' in props) args.categories = 'images';
	if ('result_detail' in props) args.result_detail = 'full';
	if ('format' in props && !('result_detail' in props)) args.format = 'json';
	return args;
}

/** Resolve a query through an enabled MCP search tool. Returns image URLs. */
export async function resolveImages(query: string): Promise<string[]> {
	if (!query) return [];
	try {
		await mcpStore.ensureTools();
	} catch {
		// Discovery failure must not throw; fall through to no tool.
	}
	const tool = pickSearchTool(mcpStore.tools);
	if (!tool) return [];
	const server = mcpStore.servers.find((entry) => entry.id === tool.serverId && entry.enabled);
	if (!server) return [];
	const args = buildSearchArgs(tool, query);
	if (import.meta.env.DEV) {
		console.log('%c[ImageSearch] search via tool', 'color:#a855f7;font-weight:bold', tool.name, args);
	}
	try {
		const result = await callTool(server, tool.name, args);
		const urls = extractImageUrls(result.content);
		if (import.meta.env.DEV) {
			console.log(
				'%c[ImageSearch] tool result',
				'color:#a855f7;font-weight:bold',
				`${urls.length} image urls`,
				result.content.slice(0, 200)
			);
		}
		return urls;
	} catch (err) {
		console.debug('[ImageSearch] search tool failed:', err);
		return [];
	}
}

/** Fallback path: resolve the query and show whatever pictures come back. */
export async function showImagesForQuery(query: string): Promise<void> {
	const urls = await resolveImages(query);
	if (urls.length) showImages(urls);
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
	const index = imageSearchStore.focusedIndex;
	const result = imageSearchStore.results[index];
	if (!result) return;
	const vision = resolveVisionLLM();
	if (!vision) return;

	const seq = ++describeSeq;
	const image = await fetchImage(result.url);
	if (!image || seq !== describeSeq) return;
	try {
		const request = describeImagesRequest('', [{ mimeType: image.mimeType, base64: image.data }]);
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
		// Only apply when this is still the focused picture of the same show.
		if (
			seq !== describeSeq ||
			!clean ||
			!imageSearchStore.isOpen ||
			imageSearchStore.focusedIndex !== index ||
			imageSearchStore.results[index]?.url !== result.url
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

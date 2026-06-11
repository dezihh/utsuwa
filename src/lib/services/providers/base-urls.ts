import type { LLMProvider } from '$lib/types';

/**
 * Default base URLs for all supported LLM providers.
 * Single source of truth used by both the SvelteKit server route
 * and the direct client fetch (Tauri / local builds).
 */
export const PROVIDER_BASE_URLS: Partial<Record<LLMProvider, string>> = {
	// Cloud
	openai: 'https://api.openai.com/v1/',
	anthropic: 'https://api.anthropic.com/v1/',
	google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
	deepseek: 'https://api.deepseek.com/',
	xai: 'https://api.x.ai/v1/',
	openrouter: 'https://openrouter.ai/api/v1/',
	// Local
	ollama: 'http://localhost:11434/v1/',
	lmstudio: 'http://localhost:1234/v1/',
	llamacpp: 'http://localhost:11435/v1/'
};

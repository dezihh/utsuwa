import test from 'node:test';
import assert from 'node:assert/strict';

import {
	getChatBaseUrl,
	getModelsBaseUrl,
	isLocalLLMProvider,
	getLocalProviderConnectionHint
} from './local-endpoints.ts';

test('identifies custom endpoint as the local-compatible provider', () => {
	assert.equal(isLocalLLMProvider('custom-endpoint'), true);
	assert.equal(isLocalLLMProvider('openai'), false);
	assert.equal(isLocalLLMProvider('ollama'), false);
});

test('custom endpoint returns the provided base URL', () => {
	assert.equal(getChatBaseUrl('custom-endpoint', 'http://localhost:11434/v1'), 'http://localhost:11434/v1');
	assert.equal(getModelsBaseUrl('custom-endpoint', 'http://localhost:11434'), 'http://localhost:11434');
});

test('legacy local providers are no longer supported', () => {
	assert.match(getLocalProviderConnectionHint('ollama'), /no longer supported/);
});

test('provides local endpoint troubleshooting hints for custom endpoint', () => {
	assert.match(getLocalProviderConnectionHint('custom-endpoint', 'http://localhost:11434'), /ollama serve/);
	assert.match(
		getLocalProviderConnectionHint(
			'custom-endpoint',
			'http://localhost:11434',
			'https://utsuwa-git-fix-ollama-local-provider.vercel.app'
		),
		/OLLAMA_ORIGINS="https:\/\/utsuwa-git-fix-ollama-local-provider\.vercel\.app"/
	);
	assert.match(
		getLocalProviderConnectionHint('custom-endpoint', 'http://localhost:11434'),
		/docs\.ollama\.com\/faq#how-can-i-allow-additional-web-origins-to-access-ollama/
	);
	assert.match(getLocalProviderConnectionHint('custom-endpoint', 'http://localhost:1234/v1'), /Start Server/);
	assert.match(getLocalProviderConnectionHint('custom-endpoint', 'http://localhost:8080/v1'), /llama-server/);
});

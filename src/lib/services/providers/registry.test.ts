import test from 'node:test';
import assert from 'node:assert/strict';

import { LLM_PROVIDERS, TTS_PROVIDERS, getTTSProvider, providerSupportsVision } from './registry.ts';

test('custom endpoint provider exposes templates and no static models', () => {
	const custom = LLM_PROVIDERS.find((provider) => provider.id === 'custom-endpoint');
	if (!custom) {
		assert.fail('custom-endpoint provider should exist');
	}
	assert.ok(custom.endpointTemplates && custom.endpointTemplates.length > 0, 'custom-endpoint should expose endpoint templates');
	assert.deepEqual(custom.models ?? [], [], 'custom-endpoint should not expose static model choices');
});

test('LLM provider set includes cloud, local, and custom endpoint options', () => {
	const ids = LLM_PROVIDERS.map((p) => p.id).sort();
	assert.deepEqual(ids, ['anthropic', 'custom-endpoint', 'deepseek', 'google', 'lmstudio', 'ollama', 'openai', 'openrouter', 'xai']);
});

test('local TTS provider is keyless, local, and ships fallback voices', () => {
	const localTTS = getTTSProvider('local-tts');

	assert.ok(localTTS, 'local-tts should be registered');
	assert.equal(localTTS?.isLocal, true);
	assert.equal(localTTS?.requiresApiKey, false);
	assert.ok((localTTS?.voices?.length ?? 0) > 0, 'local-tts should seed voices for offline use');
});

test('every TTS provider declares whether it needs an API key', () => {
	for (const provider of TTS_PROVIDERS) {
		assert.equal(typeof provider.requiresApiKey, 'boolean', `${provider.name} must declare requiresApiKey`);
	}
});

test('vision-capable cloud providers are flagged; text-only and local are not', () => {
	assert.equal(providerSupportsVision('openai'), true);
	assert.equal(providerSupportsVision('anthropic'), true);
	assert.equal(providerSupportsVision('google'), true);
	assert.equal(providerSupportsVision('xai'), true);
	assert.equal(providerSupportsVision('deepseek'), false);
	assert.equal(providerSupportsVision('ollama'), false);
	assert.equal(providerSupportsVision('lmstudio'), false);
});

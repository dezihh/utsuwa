import test from 'node:test';
import assert from 'node:assert/strict';

import { LLM_PROVIDERS } from './registry.ts';

test('custom endpoint provider exposes templates and no static models', () => {
	const custom = LLM_PROVIDERS.find((provider) => provider.id === 'custom-endpoint');
	if (!custom) {
		assert.fail('custom-endpoint provider should exist');
	}
	assert.ok(custom.endpointTemplates && custom.endpointTemplates.length > 0, 'custom-endpoint should expose endpoint templates');
	assert.deepEqual(custom.models ?? [], [], 'custom-endpoint should not expose static model choices');
});

test('LLM provider set is reduced to four options', () => {
	const ids = LLM_PROVIDERS.map((p) => p.id).sort();
	assert.deepEqual(ids, ['anthropic', 'custom-endpoint', 'openai', 'openrouter']);
});

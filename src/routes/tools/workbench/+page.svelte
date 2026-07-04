<script lang="ts">
	import { browser } from '$app/environment';
	import type { LLMProvider } from '$lib/types';
	import { onMount } from 'svelte';

	interface StoredState {
		systemPrompt: string;
		userMessage: string;
		provider: string;
		model: string;
		baseURL: string;
		apiKey: string;
		llmTemperature: number;
		llmTopP: number;
		llmMaxTokens: number;
	}

	const STORAGE_KEY = 'utsuwa-prompt-workbench';
	const DEFAULT_SYSTEM = `You are Utsuwa, a helpful AI companion.

LANGUAGE TAGS: When writing ANY word or phrase in es, wrap it in XML language tags: <lang code="es">word</lang>. Example: "<lang code="es">corazón</lang> means heart." Never skip this — pronunciation will be wrong without it.

Only Spanish PHRASES with at least 2 words AND at least 12 characters should be wrapped in <lang code="es">...</lang> for the alternative voice. Single Spanish words and short phrases stay in the main voice to avoid audio noise.`;

	let systemPrompt = $state(DEFAULT_SYSTEM);
	let userMessage = $state('Sag mir bitte ein spanisches Wort für "Auto" und erkläre kurz den Unterschied zwischen "un" und "una".');
	let provider = $state<LLMProvider>('custom-endpoint');
	let model = $state('');
	let baseURL = $state('');
	let apiKey = $state('');
	let llmTemperature = $state(0.7);
	let llmTopP = $state(0.9);
	let llmMaxTokens = $state(1024);

	let output = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let abortController: AbortController | null = null;

	onMount(() => {
		if (!browser) return;
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		try {
			const saved = JSON.parse(raw) as StoredState;
			systemPrompt = saved.systemPrompt ?? DEFAULT_SYSTEM;
			userMessage = saved.userMessage ?? userMessage;
			provider = (saved.provider as LLMProvider) ?? provider;
			model = saved.model ?? model;
			baseURL = saved.baseURL ?? baseURL;
			apiKey = saved.apiKey ?? apiKey;
			llmTemperature = saved.llmTemperature ?? llmTemperature;
			llmTopP = saved.llmTopP ?? llmTopP;
			llmMaxTokens = saved.llmMaxTokens ?? llmMaxTokens;
		} catch {
			// ignore corrupt storage
		}
	});

	function persist() {
		if (!browser) return;
		const state: StoredState = {
			systemPrompt,
			userMessage,
			provider,
			model,
			baseURL,
			apiKey,
			llmTemperature,
			llmTopP,
			llmMaxTokens
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	}

	async function handleSend() {
		if (isLoading) return;
		output = '';
		error = '';
		isLoading = true;
		persist();

		abortController = new AbortController();

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: abortController.signal,
				body: JSON.stringify({
					messages: [{ role: 'user', content: userMessage }],
					provider,
					model,
					apiKey: apiKey || undefined,
					baseURL: baseURL || undefined,
					systemPrompt,
					llmTemperature,
					llmTopP,
					llmMaxTokens
				})
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				error = data.error || `Server error ${response.status}`;
				isLoading = false;
				return;
			}

			const reader = response.body?.getReader();
			if (!reader) {
				error = 'No response body';
				isLoading = false;
				return;
			}

			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line) continue;
					if (line.startsWith('0:')) {
						try {
							const chunk = JSON.parse(line.slice(2)) as string;
							output += chunk;
						} catch {
							// ignore malformed chunk
						}
					} else if (line.startsWith('e:')) {
						try {
							const err = JSON.parse(line.slice(2)) as { error?: string };
							error = err.error || 'Stream error';
						} catch {
							error = 'Stream error';
						}
					}
				}
			}
			isLoading = false;
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				isLoading = false;
				return;
			}
			error = err instanceof Error ? err.message : String(err);
			isLoading = false;
		}
	}

	function handleStop() {
		abortController?.abort();
		isLoading = false;
	}

	function handleClear() {
		output = '';
		error = '';
	}
</script>

<svelte:head>
	<title>Prompt Workbench — Utsuwa</title>
</svelte:head>

<div class="workbench">
	<header class="header">
		<h1>Prompt Workbench</h1>
		<p class="subtitle">
			Isoliertes Testen von System-Prompts und Sprachumschaltung. Verwendet denselben Server-Endpunkt wie die App.
		</p>
	</header>

	<div class="grid">
		<section class="panel">
			<h2>System Prompt</h2>
			<textarea bind:value={systemPrompt} rows="18" spellcheck="false"></textarea>
		</section>

		<section class="panel">
			<h2>User Message</h2>
			<textarea bind:value={userMessage} rows="6" spellcheck="false"></textarea>

			<h2>Provider Settings</h2>
			<div class="fields">
				<label>
					Provider
					<select bind:value={provider}>
						<option value="custom-endpoint">Custom Endpoint (OpenAI-compatible)</option>
						<option value="openai">OpenAI</option>
						<option value="anthropic">Anthropic</option>
						<option value="openrouter">OpenRouter</option>
						<option value="google">Google</option>
						<option value="xai">xAI</option>
					</select>
				</label>

				<label>
					Model
					<input type="text" bind:value={model} placeholder="z. B. qwen2.5-7b-uncensored" />
				</label>

				<label>
					Base URL
					<input type="text" bind:value={baseURL} placeholder="http://host.docker.internal:4000" />
				</label>

				<label>
					API Key
					<input type="password" bind:value={apiKey} placeholder="optional für custom endpoint" />
				</label>

				<div class="row">
					<label>
						Temperature
						<input type="number" bind:value={llmTemperature} min="0" max="2" step="0.1" />
					</label>
					<label>
						Top P
						<input type="number" bind:value={llmTopP} min="0" max="1" step="0.05" />
					</label>
					<label>
						Max Tokens
						<input type="number" bind:value={llmMaxTokens} min="1" max="8192" step="1" />
					</label>
				</div>
			</div>

			<div class="actions">
				{#if isLoading}
					<button class="primary" onclick={handleStop}>Stop</button>
				{:else}
					<button class="primary" onclick={handleSend}>Senden</button>
				{/if}
				<button onclick={handleClear}>Clear Output</button>
			</div>
		</section>
	</div>

	<section class="output panel">
		<h2>Raw LLM Response</h2>
		{#if error}
			<div class="error">{error}</div>
		{/if}
		<pre>{output || (isLoading ? 'Warte auf Antwort…' : 'Noch keine Antwort.')}</pre>
	</section>
</div>

<style>
	.workbench {
		height: 100vh;
		width: 100vw;
		overflow: auto;
		padding: 1.5rem;
		box-sizing: border-box;
		background: #0f0f13;
		color: #e2e2e8;
		font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.header {
		margin-bottom: 1.5rem;
	}

	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.subtitle {
		margin: 0;
		color: #a0a0b0;
		font-size: 0.9rem;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	.panel {
		background: #18181f;
		border: 1px solid #2a2a35;
		border-radius: 0.75rem;
		padding: 1rem;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
		font-weight: 600;
		color: #d4d4e0;
	}

	textarea,
	input,
	select {
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: #111118;
		border: 1px solid #2f2f3d;
		border-radius: 0.5rem;
		color: #e2e2e8;
		font-size: 0.9rem;
		box-sizing: border-box;
	}

	textarea {
		resize: vertical;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		line-height: 1.5;
	}

	input:focus,
	textarea:focus,
	select:focus {
		outline: none;
		border-color: #6366f1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #a0a0b0;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	button {
		padding: 0.5rem 1rem;
		border: 1px solid #2f2f3d;
		border-radius: 0.5rem;
		background: #1f1f28;
		color: #e2e2e8;
		cursor: pointer;
		font-size: 0.9rem;
	}

	button:hover {
		background: #262630;
	}

	button.primary {
		background: #4f46e5;
		border-color: #4f46e5;
	}

	button.primary:hover {
		background: #4338ca;
	}

	.output pre {
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.85rem;
		line-height: 1.5;
		min-height: 8rem;
	}

	.error {
		background: #450a0a;
		color: #fecaca;
		padding: 0.75rem;
		border-radius: 0.5rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
	}
</style>

<script lang="ts">
	import { browser } from '$app/environment';
	import type { SpeechSegment } from '$lib/services/voice-orchestrator';
	import { splitIntoSegments } from '$lib/utils/sentences';
	import { onMount } from 'svelte';

	interface StoredState {
		text: string;
		baseUrl: string;
		defaultVoiceMode: 'clone' | 'synthetic';
		defaultVoiceClone: string;
		defaultVoiceSynthetic: string;
		altVoiceMode: 'clone' | 'synthetic';
		altVoiceClone: string;
		altVoiceSynthetic: string;
		defaultLanguage: string;
		altLanguage: string;
		numStep: number;
		paddingTarget: number;
		defaultSpeed?: number;
		altSpeed?: number;
	}

	const STORAGE_KEY = 'utsuwa-speech-workbench';

	let text = $state('[happy]Hey! Klar, gern! <lang code="es">un</lang> steht immer vor maskulinen Substantiven. <lang code="es">te quiero</lang> ist so schön. <lang code="es">Vamos</lang>!');
	let baseUrl = $state('http://localhost:8766');

	let defaultVoiceMode = $state<'clone' | 'synthetic'>('clone');
	let defaultVoiceClone = $state('female3');
	let defaultVoiceSynthetic = $state('female, young adult, moderate pitch');

	let altVoiceMode = $state<'clone' | 'synthetic'>('clone');
	let altVoiceClone = $state('female3_spain');
	let altVoiceSynthetic = $state('male, young adult, moderate pitch');

	let defaultLanguage = $state('de');
	let altLanguage = $state('es');
	let numStep = $state(32);
	let paddingTarget = $state(10);
	let defaultSpeed = $state<number | undefined>(undefined);
	let altSpeed = $state<number | undefined>(undefined);

	let segments: (SpeechSegment & { assignedVoice: 'main' | 'alt'; paddedText: string })[] = $state([]);
	let loading = $state<Record<number, boolean>>({});
	let errors = $state<Record<number, string>>({});
	let audioCtx: AudioContext | null = null;

	interface OmniVoiceVoice {
		voice_id: string;
		name?: string;
		is_builtin?: boolean;
	}
	let voices = $state<OmniVoiceVoice[]>([]);
	let voicesLoading = $state(false);
	let voicesError = $state('');

	function getVoiceValue(mode: 'clone' | 'synthetic', clone: string, synthetic: string): string {
		return mode === 'synthetic' ? `instruct:${synthetic}` : clone;
	}

	function defaultVoice(): string {
		return getVoiceValue(defaultVoiceMode, defaultVoiceClone, defaultVoiceSynthetic);
	}

	function altVoice(): string {
		return getVoiceValue(altVoiceMode, altVoiceClone, altVoiceSynthetic);
	}

	async function fetchVoices() {
		voicesLoading = true;
		voicesError = '';
		try {
			const res = await fetch(`/api/tts/omnivoice/voices?baseUrl=${encodeURIComponent(baseUrl)}`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || `HTTP ${res.status}`);
			}
			const data = await res.json();
			voices = Array.isArray(data.voices) ? data.voices : data;
		} catch (err) {
			voicesError = err instanceof Error ? err.message : String(err);
		} finally {
			voicesLoading = false;
		}
	}

	onMount(() => {
		if (!browser) return;
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			analyze();
			return;
		}
		try {
			const saved = JSON.parse(raw) as StoredState;
			text = saved.text ?? text;
			baseUrl = saved.baseUrl ?? baseUrl;
			defaultVoiceMode = saved.defaultVoiceMode ?? defaultVoiceMode;
			defaultVoiceClone = saved.defaultVoiceClone ?? defaultVoiceClone;
			defaultVoiceSynthetic = saved.defaultVoiceSynthetic ?? defaultVoiceSynthetic;
			altVoiceMode = saved.altVoiceMode ?? altVoiceMode;
			altVoiceClone = saved.altVoiceClone ?? altVoiceClone;
			altVoiceSynthetic = saved.altVoiceSynthetic ?? altVoiceSynthetic;
			defaultLanguage = saved.defaultLanguage ?? defaultLanguage;
			altLanguage = saved.altLanguage ?? altLanguage;
			numStep = saved.numStep ?? numStep;
			paddingTarget = saved.paddingTarget ?? paddingTarget;
			defaultSpeed = saved.defaultSpeed ?? defaultSpeed;
			altSpeed = saved.altSpeed ?? altSpeed;
		} catch {
			// ignore
		}
		analyze();
	});

	function persist() {
		if (!browser) return;
		const state: StoredState = {
			text,
			baseUrl,
			defaultVoiceMode,
			defaultVoiceClone,
			defaultVoiceSynthetic,
			altVoiceMode,
			altVoiceClone,
			altVoiceSynthetic,
			defaultLanguage,
			altLanguage,
			numStep,
			paddingTarget,
			defaultSpeed,
			altSpeed
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	}

	function analyze() {
		persist();
		const rawSegments = splitIntoSegments(text, defaultLanguage);

		segments = rawSegments.map((seg) => {
			const isAlt = seg.language === altLanguage;
			const assignedVoice: 'main' | 'alt' = isAlt ? 'alt' : 'main';

			let paddedText = seg.text.trimEnd();
			if (paddedText.trim().length < paddingTarget) {
				const needed = paddingTarget - paddedText.trim().length;
				paddedText += '...'.slice(0, needed);
			}

			return {
				...seg,
				assignedVoice,
				paddedText
			};
		});
	}

	function voiceForSegment(seg: (typeof segments)[number], override?: 'main' | 'alt'): string {
		const useAlt = override ?? seg.assignedVoice === 'alt';
		return useAlt ? altVoice() : defaultVoice();
	}

	function languageForSegment(seg: (typeof segments)[number], override?: 'main' | 'alt'): string | undefined {
		const useAlt = override ?? seg.assignedVoice === 'alt';
		return useAlt ? altLanguage : defaultLanguage;
	}

	function speedForSegment(seg: (typeof segments)[number], override?: 'main' | 'alt'): number | undefined {
		const useAlt = override ?? seg.assignedVoice === 'alt';
		return useAlt ? altSpeed : defaultSpeed;
	}

	async function playSegment(index: number, override?: 'main' | 'alt'): Promise<void> {
		if (!browser) return;
		const seg = segments[index];
		if (!seg) return;

		loading = { ...loading, [index]: true };
		errors = { ...errors, [index]: '' };

		try {
			const voice = voiceForSegment(seg, override);
			const language = languageForSegment(seg, override);
			const speed = speedForSegment(seg, override);
			const body = {
				text: seg.paddedText,
				voice,
				numStep,
				language,
				baseUrl,
				...(speed !== undefined ? { speed } : {})
			};
			console.log('[Workbench] TTS request:', body);

			const response = await fetch('/api/tts/omnivoice/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				throw new Error(data.error || `HTTP ${response.status}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer.byteLength) {
				throw new Error('Empty audio response');
			}

			if (!audioCtx) {
				audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
			}

			const buffer = await audioCtx.decodeAudioData(arrayBuffer);
			const source = audioCtx.createBufferSource();
			source.buffer = buffer;
			source.connect(audioCtx.destination);

			await new Promise<void>((resolve) => {
				source.onended = () => resolve();
				source.start(0);
			});
		} catch (err) {
			errors = { ...errors, [index]: err instanceof Error ? err.message : String(err) };
		} finally {
			loading = { ...loading, [index]: false };
		}
	}

	async function playAll() {
		for (let i = 0; i < segments.length; i++) {
			await playSegment(i);
		}
	}

	const SYNTHETIC_HINTS = [
		'male, young adult, moderate pitch',
		'female, young adult, moderate pitch',
		'male, middle-aged, low pitch',
		'female, elderly, high pitch'
	];
</script>

<svelte:head>
	<title>Speech Workbench — Utsuwa</title>
</svelte:head>

<div class="workbench">
	<header class="header">
		<h1>Speech Workbench</h1>
		<p class="subtitle">
			Teste TTS-Segmentierung und Sprachumschaltung isoliert. Jedes Segment kann einzeln an OmniVoice gesendet werden.
		</p>
	</header>

	<div class="grid">
		<section class="panel">
			<h2>Input Text</h2>
			<textarea bind:value={text} rows="10" spellcheck="false"></textarea>
			<button class="primary" onclick={analyze}>Analysieren</button>

			<h2>Segmente</h2>
			{#if segments.length === 0}
				<p class="muted">Keine Segmente gefunden.</p>
			{:else}
				<div class="segments">
					{#each segments as seg, i (i)}
						<div class="segment">
							<div class="seg-meta">
								<span class="badge index">#{i + 1}</span>
								<span class="badge lang">{seg.language || defaultLanguage}</span>
								<span class="badge voice" class:alt={seg.assignedVoice === 'alt'}>
									{seg.assignedVoice === 'alt' ? 'Alt-Stimme' : 'Hauptstimme'}
								</span>
								<span class="badge len">{seg.text.trim().length} chars / {seg.text.trim().split(/\s+/).filter(Boolean).length} words</span>
							</div>
							<div class="seg-text">{seg.text}</div>
							{#if seg.paddedText !== seg.text}
								<div class="seg-padded">padded: {seg.paddedText}</div>
							{/if}
							<div class="seg-actions">
								<button onclick={() => playSegment(i)} disabled={loading[i]}>
									{loading[i] ? '...' : 'Vorhergesagte Stimme abspielen'}
								</button>
								<button onclick={() => playSegment(i, 'alt')} disabled={loading[i]}>
									Alt-Stimme testen
								</button>
								<button onclick={() => playSegment(i, 'main')} disabled={loading[i]}>
									Hauptstimme testen
								</button>
							</div>
							{#if errors[i]}
								<div class="seg-error">{errors[i]}</div>
							{/if}
						</div>
					{/each}
				</div>
				<button class="primary" onclick={playAll}>Alle nacheinander abspielen</button>
			{/if}
		</section>

		<section class="panel">
			<h2>OmniVoice Verbindung</h2>
			<div class="fields">
				<label>
					Base URL
					<input type="text" bind:value={baseUrl} onchange={analyze} />
				</label>
				<button onclick={fetchVoices} disabled={voicesLoading}>
					{voicesLoading ? 'Lade...' : 'Stimmen von OmniVoice abrufen'}
				</button>
				{#if voicesError}
					<div class="seg-error">{voicesError}</div>
				{/if}
			</div>

			<h2>Hauptstimme</h2>
			<div class="fields">
				<div class="mode-row">
					<label class="inline">
						<input type="radio" bind:group={defaultVoiceMode} value="clone" onchange={analyze} />
						Clone
					</label>
					<label class="inline">
						<input type="radio" bind:group={defaultVoiceMode} value="synthetic" onchange={analyze} />
						Synthetisch
					</label>
				</div>
				{#if defaultVoiceMode === 'clone'}
					<label>
						Clone-Stimme
						{#if voices.length > 0}
							<select bind:value={defaultVoiceClone} onchange={analyze}>
								{#each voices as v}
									<option value={v.voice_id}>{v.name || v.voice_id} {v.is_builtin ? '(built-in)' : ''}</option>
								{/each}
							</select>
						{:else}
							<input type="text" bind:value={defaultVoiceClone} onchange={analyze} />
						{/if}
					</label>
				{:else}
					<label>
						Synthetische Beschreibung
						<input type="text" bind:value={defaultVoiceSynthetic} onchange={analyze} />
						<span class="hint">Beispiel: female, middle-aged, moderate pitch</span>
					</label>
				{/if}
			</div>

			<h2>Alt-Stimme</h2>
			<div class="fields">
				<div class="mode-row">
					<label class="inline">
						<input type="radio" bind:group={altVoiceMode} value="clone" onchange={analyze} />
						Clone
					</label>
					<label class="inline">
						<input type="radio" bind:group={altVoiceMode} value="synthetic" onchange={analyze} />
						Synthetisch
					</label>
				</div>
				{#if altVoiceMode === 'clone'}
					<label>
						Clone-Stimme
						{#if voices.length > 0}
							<select bind:value={altVoiceClone} onchange={analyze}>
								{#each voices as v}
									<option value={v.voice_id}>{v.name || v.voice_id} {v.is_builtin ? '(built-in)' : ''}</option>
								{/each}
							</select>
						{:else}
							<input type="text" bind:value={altVoiceClone} onchange={analyze} />
						{/if}
					</label>
				{:else}
					<label>
						Synthetische Beschreibung
						<input type="text" bind:value={altVoiceSynthetic} onchange={analyze} />
						<span class="hint">Beispiel: male, middle-aged, low pitch</span>
					</label>
				{/if}
				<p class="hint">
					Für Spanisch eignet sich <strong>female3_spain</strong> als Clone. Für einen klaren Stimmwechsel teste eine synthetische männliche Alt-Stimme.
				</p>
			</div>

			<h2>Experiment-Parameter</h2>
			<div class="fields">
				<label>
					Hauptsprache
					<input type="text" bind:value={defaultLanguage} onchange={analyze} />
				</label>
				<label>
					Alt-Sprache
					<input type="text" bind:value={altLanguage} onchange={analyze} />
				</label>
				<label>
					num_step (OmniVoice Diffusion Steps)
					<input type="number" bind:value={numStep} min="1" max="100" onchange={analyze} />
				</label>
				<label>
					Hauptstimme Speed
					<input
						type="number"
						step="0.05"
						min="0.1"
						max="2"
						value={defaultSpeed ?? ''}
						onchange={(e) => {
							const v = parseFloat((e.currentTarget as HTMLInputElement).value);
							defaultSpeed = isNaN(v) ? undefined : v;
						}}
					/>
					<span class="hint">Leer = OmniVoice-Default (meist 1.0)</span>
				</label>
				<label>
					Alt-Stimme Speed
					<input
						type="number"
						step="0.05"
						min="0.1"
						max="2"
						value={altSpeed ?? ''}
						onchange={(e) => {
							const v = parseFloat((e.currentTarget as HTMLInputElement).value);
							altSpeed = isNaN(v) ? undefined : v;
						}}
					/>
					<span class="hint">Leer = OmniVoice-Default</span>
				</label>
				<label>
					Padding-Ziel (Zeichen)
					<input type="number" bind:value={paddingTarget} min="1" max="50" onchange={analyze} />
					<span class="hint">
						Kurze Segmente werden mit Auslassungspunkten auf diese Länge aufgefüllt.
					</span>
				</label>
			</div>
		</section>
	</div>
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
		grid-template-columns: 1.4fr 0.6fr;
		gap: 1rem;
		align-items: start;
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
		margin: 1rem 0 0.75rem;
		font-size: 1rem;
		font-weight: 600;
		color: #d4d4e0;
	}

	h2:first-child {
		margin-top: 0;
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
		margin-bottom: 0.75rem;
	}

	input:focus,
	textarea:focus,
	select:focus {
		outline: none;
		border-color: #6366f1;
	}

	select {
		appearance: auto;
	}

	button {
		padding: 0.5rem 1rem;
		border: 1px solid #2f2f3d;
		border-radius: 0.5rem;
		background: #1f1f28;
		color: #e2e2e8;
		cursor: pointer;
		font-size: 0.85rem;
	}

	button:hover:not(:disabled) {
		background: #262630;
	}

	button.primary {
		background: #4f46e5;
		border-color: #4f46e5;
	}

	button.primary:hover:not(:disabled) {
		background: #4338ca;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #a0a0b0;
	}

	label.inline {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
	}

	label.inline input[type='radio'] {
		width: auto;
	}

	.mode-row {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.25rem;
	}

	.hint {
		font-size: 0.75rem;
		color: #808090;
	}

	.segments {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.segment {
		background: #111118;
		border: 1px solid #2a2a35;
		border-radius: 0.5rem;
		padding: 0.75rem;
	}

	.seg-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}

	.badge {
		padding: 0.15rem 0.4rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		background: #2a2a35;
		color: #d4d4e0;
	}

	.badge.alt {
		background: #4f46e5;
	}

	.seg-text {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.9rem;
		color: #e2e2e8;
		margin-bottom: 0.25rem;
	}

	.seg-padded {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		color: #808090;
		margin-bottom: 0.5rem;
	}

	.seg-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.seg-error {
		margin-top: 0.5rem;
		background: #450a0a;
		color: #fecaca;
		padding: 0.5rem;
		border-radius: 0.5rem;
		font-size: 0.8rem;
	}

	.muted {
		color: #808090;
		font-size: 0.9rem;
	}
</style>

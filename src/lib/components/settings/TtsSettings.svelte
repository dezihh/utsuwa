<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modulesStore } from '$lib/stores/modules.svelte';
	import { getTTSProvider } from '$lib/services/providers/registry';
	import { getSharedAudioContext } from '$lib/services/tts';
	import { Icon, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import type { TtsSettingsState } from '$lib/stores/ai-services-settings.svelte';
	import './ai-services-settings.css';

	let { state: tts }: { state: TtsSettingsState } = $props();

	// ── OmniVoice local state ────────────────────────────────
	let showCloneModal = $state(false);
	let cloneVoiceId = $state('');
	let cloneRefText = $state('');
	let cloneRefAudio: File | null = $state(null);
	let cloneFileName = $state('');
	let cloneError = $state('');
	let cloneLoading = $state(false);
	let clonedVoices = $state([] as Array<{ id: string; name: string }>);
	let cloneTargetAlt = $state(false);
	let cloneFetchTimer: ReturnType<typeof setTimeout> | undefined;
	let cloneDeleting = $state('');

	// Proxy health
	let proxyStatus = $state<'connecting' | 'connected' | 'disconnected' | 'idle'>('idle');
	let proxyCheckTimer: ReturnType<typeof setInterval> | undefined;

	// Preview
	let previewLoading = $state(false);
	let previewTarget: 'primary' | 'alt' = $state('primary');

	const TEST_PHRASES: Record<string, string> = {
		de: 'Hallo, dies ist ein Test von OmniVoice.',
		en: 'Hello, this is a test of OmniVoice text to speech.',
		es: 'Hola, esta es una prueba de OmniVoice.',
		fr: 'Bonjour, ceci est un test de OmniVoice.',
		it: 'Ciao, questo è un test di OmniVoice.',
		pt: 'Olá, este é um teste do OmniVoice.',
		ja: 'こんにちは、これはOmniVoiceのテストです。',
		ko: '안녕하세요, OmniVoice 테스트입니다.',
		zh: '你好，这是OmniVoice的测试。',
		ru: 'Здравствуйте, это тест OmniVoice.',
		nl: 'Hallo, dit is een test van OmniVoice.',
		pl: 'Cześć, to jest test OmniVoice.',
		tr: 'Merhaba, bu OmniVoice bir testidir.',
		sv: 'Hej, detta är ett test av OmniVoice.'
	};

	const COMMON_LANGUAGES = [
		{ code: 'de', name: 'German' },
		{ code: 'en', name: 'English' },
		{ code: 'es', name: 'Spanish' },
		{ code: 'fr', name: 'French' },
		{ code: 'it', name: 'Italian' },
		{ code: 'pt', name: 'Portuguese' },
		{ code: 'ja', name: 'Japanese' },
		{ code: 'ko', name: 'Korean' },
		{ code: 'zh', name: 'Chinese' },
		{ code: 'ru', name: 'Russian' },
		{ code: 'ar', name: 'Arabic' },
		{ code: 'nl', name: 'Dutch' },
		{ code: 'pl', name: 'Polish' },
		{ code: 'tr', name: 'Turkish' },
		{ code: 'sv', name: 'Swedish' }
	];

const GENDERS = ['male', 'female'] as const;
	const PITCHES = ['very low', 'low', 'moderate', 'high', 'very high'] as const;
	const AGES = ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'] as const;
	const NUMSTEPS = [16, 32] as const;

	function buildInstructions(gender: string, pitch: string, age: string): string {
		return [gender, age, pitch + ' pitch'].join(', ');
	}

	function parseInstructions(instr: string): { gender: string; pitch: string; age: string } {
		const i = instr.toLowerCase();
		let gender = 'female';
		let pitch = 'moderate';
		let age = 'young adult';
		if (i.includes('male') && !i.includes('female')) gender = 'male';
		for (const p of [...PITCHES].sort((a, b) => b.length - a.length)) { if (i.includes(p)) { pitch = p; break; } }
		for (const a of AGES) { if (i.includes(a)) { age = a; break; } }
		return { gender, pitch, age };
	}

	// ── Helpers ───────────────────────────────────────────────

	const primaryDesign = $derived.by(() =>
		parseInstructions(tts.speechSettings.instructions as string || '')
	);
	const altDesign = $derived.by(() =>
		parseInstructions(tts.speechSettings.altInstructions as string || '')
	);

	function pickOmniVoicePreset(gender: string): string {
		// Pick a stable preset that matches the requested gender. These are
		// OmniVoice's built-in voices (see tools/omnivoice/omnivoice-proxy.py PRESETS).
		return gender === 'male' ? 'onyx' : 'alloy';
	}

	function setPrimaryDesign(gender?: string, pitch?: string, age?: string) {
		const g = gender ?? primaryDesign.gender;
		const p = pitch ?? primaryDesign.pitch;
		const a = age ?? primaryDesign.age;
		tts.handleTTSInstructionsChange(buildInstructions(g, p, a));
		// In synthetic mode the voiceId is the preset that matches the design.
		tts.handleTTSVoiceChange(pickOmniVoicePreset(g));
	}

	function setAltDesign(gender?: string, pitch?: string, age?: string) {
		const g = gender ?? altDesign.gender;
		const p = pitch ?? altDesign.pitch;
		const a = age ?? altDesign.age;
		tts.handleTTSAltInstructionsChange(buildInstructions(g, p, a));
		// In synthetic mode the voiceId is the preset that matches the design.
		tts.handleTTSAltVoiceChange(pickOmniVoicePreset(g));
	}

	const primaryVoiceId = $derived.by(() => (tts.speechSettings.activeVoiceId as string) || '');
	let primaryShowClone = $state(false);
	const isPrimaryClone = $derived.by(() => primaryVoiceId.startsWith('clone:') || primaryShowClone);

	const altVoiceId = $derived.by(() => (tts.speechSettings.altVoiceId as string) || '');
	let altShowClone = $state(false);
	const isAltClone = $derived.by(() => altVoiceId.startsWith('clone:') || altShowClone);

	function baseUrl(): string {
		let url = (settingsStore.getProviderConfig('omnivoice').baseUrl || 'http://localhost:8880/v1/')
			.replace(/\/+$/, '');
		if (!url.endsWith('/v1')) url += '/v1';
		return url + '/';
	}

	async function fetchClonedVoices() {
		try {
			const res = await fetch(baseUrl() + 'voices');
			if (!res.ok) return;
			const data = await res.json();
			clonedVoices = (data.clones || []) as Array<{ id: string; name: string }>;
		} catch { /* proxy not running */ }
	}

	function scheduleCloneFetch() {
		clearTimeout(cloneFetchTimer);
		cloneFetchTimer = setTimeout(fetchClonedVoices, 500);
	}

	$effect(() => {
		if (tts.isTTSEnabled && tts.speechSettings.activeProvider === 'omnivoice') {
			scheduleCloneFetch();
			startHealthPolling();
		}
		return () => {
			clearTimeout(cloneFetchTimer);
			stopHealthPolling();
		};
	});

	// ── Health ────────────────────────────────────────────────

	async function checkProxyHealth() {
		const healthUrl = baseUrl().replace(/\/v1\/$/, '') + '/health';
		proxyStatus = 'connecting';
		try {
			const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
			proxyStatus = res.ok ? 'connected' : res.status === 503 ? 'connecting' : 'disconnected';
		} catch {
			proxyStatus = 'disconnected';
		}
	}

	function startHealthPolling() {
		proxyStatus = 'idle';
		checkProxyHealth();
		proxyCheckTimer = setInterval(checkProxyHealth, 5000);
	}

	function stopHealthPolling() {
		clearInterval(proxyCheckTimer);
		proxyCheckTimer = undefined;
		proxyStatus = 'idle';
	}

	// ── Clone ─────────────────────────────────────────────────

	async function handleCloneVoice() {
		cloneError = '';
		if (!cloneVoiceId.trim() || !cloneRefAudio || !cloneRefText.trim()) {
			cloneError = 'Please provide a voice name, reference audio, and reference text.';
			return;
		}
		cloneLoading = true;
		try {
			const formData = new FormData();
			formData.append('voice_id', cloneVoiceId.trim());
			formData.append('ref_audio', cloneRefAudio);
			if (cloneRefText.trim()) formData.append('ref_text', cloneRefText.trim());

			const res = await fetch(baseUrl() + 'voices/clone', { method: 'POST', body: formData });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
				throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
			}
			if (cloneTargetAlt) {
				tts.handleTTSAltVoiceChange('clone:' + cloneVoiceId.trim());
			} else {
				tts.handleTTSVoiceChange('clone:' + cloneVoiceId.trim());
			}
			showCloneModal = false;
			cloneVoiceId = '';
			cloneRefText = '';
			cloneRefAudio = null;
			await fetchClonedVoices();
		} catch (err) {
			cloneError = err instanceof Error ? err.message : 'Clone failed';
		} finally {
			cloneLoading = false;
		}
	}

	function openCloneModal(alt: boolean) {
		cloneTargetAlt = alt;
		cloneVoiceId = '';
		cloneRefText = '';
		cloneRefAudio = null;
		cloneFileName = '';
		cloneError = '';
		showCloneModal = true;
	}

	// ── Delete Clone ─────────────────────────────────────────

	async function deleteClone(cloneId: string) {
		cloneDeleting = cloneId;
		try {
			await fetch(baseUrl() + 'voices/clone/' + cloneId, { method: 'DELETE' });
			if ((tts.speechSettings.activeVoiceId as string) === 'clone:' + cloneId) {
				tts.handleTTSVoiceChange('');
				primaryShowClone = false;
			}
			if ((tts.speechSettings.altVoiceId as string) === 'clone:' + cloneId) {
				tts.handleTTSAltVoiceChange('');
				altShowClone = false;
			}
			await fetchClonedVoices();
		} catch { /* ignore */ }
		cloneDeleting = '';
	}

	// ── Preview ───────────────────────────────────────────────

	async function handlePreview() {
		previewTarget = 'primary';
		previewLoading = true;
		try {
			const lang = (tts.speechSettings.primaryLanguage as string) || 'de';
			const text = TEST_PHRASES[lang] || TEST_PHRASES.de;
			const voiceId = (tts.speechSettings.activeVoiceId as string) || '';
			const instructions = isPrimaryClone
				? undefined
				: ((tts.speechSettings.instructions as string) || buildInstructions('female', 'moderate', 'young adult'));

			const body: Record<string, unknown> = {
				model: 'omnivoice',
				input: text,
				response_format: 'wav'
			};
			if (voiceId && voiceId !== '') body.voice = voiceId;
			if (instructions) body.instructions = instructions;
			const speed = tts.speechSettings.speed as number;
			if (speed != null) body.speed = speed;
			const ns = tts.speechSettings.numStep as number;
			if (ns) body.num_step = ns;
			const pt = tts.speechSettings.positionTemperature as number;
			if (pt != null) body.position_temperature = pt;
			const ct = tts.speechSettings.classTemperature as number;
			if (ct != null) body.class_temperature = ct;

			const res = await fetch(baseUrl() + 'audio/speech', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const arrayBuffer = await res.arrayBuffer();
			const ctx = getSharedAudioContext();
			if (ctx.state === 'suspended') await ctx.resume();
			const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
			const source = ctx.createBufferSource();
			source.buffer = audioBuffer;
			source.connect(ctx.destination);
			source.start(0);
		} catch (err) {
			console.error('Preview failed:', err);
		} finally {
			previewLoading = false;
		}
	}

	async function handleAltPreview() {
		previewTarget = 'alt';
		previewLoading = true;
		try {
			const lang = (tts.speechSettings.altLanguage as string) || 'es';
			const text = TEST_PHRASES[lang] || TEST_PHRASES.de;
			const voiceId = (tts.speechSettings.altVoiceId as string) || '';
			const instructions = isAltClone
				? undefined
				: ((tts.speechSettings.altInstructions as string) || buildInstructions('female', 'moderate', 'young adult'));

			const body: Record<string, unknown> = {
				model: 'omnivoice',
				input: text,
				response_format: 'wav'
			};
			if (voiceId && voiceId !== '') body.voice = voiceId;
			if (instructions) body.instructions = instructions;
			const speed = ((tts.speechSettings.altSpeed ?? tts.speechSettings.speed) as number);
			if (speed != null) body.speed = speed;
			const ns = ((tts.speechSettings.altNumStep ?? tts.speechSettings.numStep) as number);
			if (ns) body.num_step = ns;
			const pt = tts.speechSettings.positionTemperature as number;
			if (pt != null) body.position_temperature = pt;
			const ct = tts.speechSettings.classTemperature as number;
			if (ct != null) body.class_temperature = ct;

			const res = await fetch(baseUrl() + 'audio/speech', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const arrayBuffer = await res.arrayBuffer();
			const ctx = getSharedAudioContext();
			if (ctx.state === 'suspended') await ctx.resume();
			const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
			const source = ctx.createBufferSource();
			source.buffer = audioBuffer;
			source.connect(ctx.destination);
			source.start(0);
		} catch (err) {
			console.error('Alt preview failed:', err);
		} finally {
			previewLoading = false;
		}
	}
</script>

<div class="service-group">
	<div class="service-header">
		<Icon name="mic" size={14} />
		<span>Speech (TTS)</span>
		<button
			class="service-toggle"
			class:enabled={tts.isTTSEnabled}
			onclick={tts.toggleTTS}
			aria-label="Toggle speech (TTS)"
		>
			<span class="toggle-track">
				<span class="toggle-thumb"></span>
			</span>
		</button>
	</div>

	{#if tts.isTTSEnabled}
		<ProviderDropdown
			type="tts"
			value={tts.speechSettings.activeProvider as string}
			onSelect={(id) => {
				if (id !== 'omnivoice') stopHealthPolling();
				tts.handleTTSProviderChange(id);
				if (id === 'omnivoice') { scheduleCloneFetch(); startHealthPolling(); }
			}}
			placeholder="Select TTS provider..."
		/>

		{#if tts.speechSettings.activeProvider}
			{@const provider = getTTSProvider(tts.speechSettings.activeProvider as string)}

			{#if provider?.requiresApiKey}
				<div class="api-key-row">
					<input
						type="password"
						class="api-key-input"
						class:error={tts.ttsFetchError}
						placeholder="API Key"
						value={settingsStore.getProviderConfig(provider.id).apiKey ?? ''}
						oninput={(e) => tts.handleApiKeyChange(provider.id, e.currentTarget.value)}
						onblur={tts.handleTTSApiKeyBlur}
					/>
				</div>
			{/if}

			{#if !provider?.isLocal}
				<ModelDropdown
					models={tts.ttsModels}
					value={tts.speechSettings.activeModel as string}
					onSelect={tts.handleTTSModelChange}
					placeholder="Select model..."
					isLoading={tts.ttsIsLoading}
					onRefresh={tts.ttsHasApiKey ? tts.fetchTTSModels : undefined}
					disabled={!tts.ttsHasApiKey}
					disabledMessage="Enter API key first"
				/>
			{/if}

			{#if tts.speechSettings.activeProvider === 'elevenlabs'}
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder="Custom Voice ID (optional)"
						value={settingsStore.elevenLabsVoiceId}
						onchange={(e) => settingsStore.setElevenLabsVoiceId(e.currentTarget.value)}
					/>
				</div>
			{/if}

			<!-- ── Non-OmniVoice local providers ── -->
			{#if provider?.isLocal && tts.speechSettings.activeProvider !== 'omnivoice'}
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						list="local-tts-voices"
						placeholder="Voice (e.g. af_bella)"
						value={tts.speechSettings.activeVoiceId as string ?? ''}
						onchange={(e) => tts.handleTTSVoiceChange(e.currentTarget.value)}
					/>
					<datalist id="local-tts-voices">
						{#each provider.voices ?? [] as voice}
							<option value={voice.id}>{voice.name}</option>
						{/each}
					</datalist>
				</div>
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder="Model (optional, e.g. kokoro)"
						value={tts.speechSettings.activeModel as string ?? ''}
						onchange={(e) => tts.handleTTSModelChange(e.currentTarget.value)}
					/>
				</div>
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder={provider.defaultBaseUrl || 'http://localhost:8880/v1/'}
						value={settingsStore.getProviderConfig(provider.id).baseUrl ?? ''}
						onchange={(e) => settingsStore.setProviderConfig(provider.id, { baseUrl: e.currentTarget.value })}
					/>
				</div>
			{/if}

			<!-- ═══════════════════════════════════════════════════════ -->
			<!-- OmniVoice Settings                                      -->
			<!-- ═══════════════════════════════════════════════════════ -->
			{#if tts.speechSettings.activeProvider === 'omnivoice'}
				{@const enableAlt = (tts.speechSettings.enableAltLanguage as boolean) || false}

				<!-- Proxy status hint -->
				<div class="omnivoice-proxy-hint">
					<span class="omnivoice-proxy-status">
						{#if proxyStatus === 'connected'}
							<span class="omnivoice-dot omnivoice-dot-ok"></span> Connected
						{:else if proxyStatus === 'connecting'}
							<span class="omnivoice-dot omnivoice-dot-warn"></span> Connecting...
						{:else if proxyStatus === 'disconnected'}
							<span class="omnivoice-dot omnivoice-dot-err"></span> Not reachable
						{:else}
							<span class="omnivoice-dot"></span> Checking...
						{/if}
					</span>
					<span class="omnivoice-proxy-cmd">python tools/omnivoice/omnivoice-proxy.py --device cuda</span>
				</div>

				<!-- Base URL -->
				<div class="api-key-row">
					<input
						type="text"
						class="api-key-input"
						placeholder="http://localhost:8880/v1/"
						value={settingsStore.getProviderConfig('omnivoice').baseUrl ?? ''}
						onchange={(e) => settingsStore.setProviderConfig('omnivoice', { baseUrl: e.currentTarget.value })}
					/>
				</div>

				<!-- ── Primary Voice Card ── -->
				<div class="omnivoice-card">
					<div class="omnivoice-card-label">Primary Voice</div>

					<div class="api-key-row">
						<select
							class="api-key-input"
							value={tts.speechSettings.primaryLanguage as string ?? 'de'}
							onchange={(e) => tts.handleTTSPrimaryLanguageChange(e.currentTarget.value)}
						>
							{#each COMMON_LANGUAGES as lang}
								<option value={lang.code}>{lang.name} ({lang.code})</option>
							{/each}
						</select>
					</div>


					<div class="omnivoice-voice-row">
						<span class="omnivoice-design-label" style="width:auto;flex-shrink:0;">Voice</span>
						<label class="omnivoice-radio">
							<input type="radio" name="ov-p-mode" value="synth"
								checked={!isPrimaryClone}
								onchange={() => {
									primaryShowClone = false;
									tts.handleTTSVoiceChange(pickOmniVoicePreset(primaryDesign.gender));
								}} />
							Synthetic
						</label>
						<label class="omnivoice-radio">
							<input type="radio" name="ov-p-mode" value="clone"
								checked={isPrimaryClone}
								onchange={() => {
									primaryShowClone = true;
									const c = clonedVoices[0];
									if (c) tts.handleTTSVoiceChange(c.id);
								}} />
							Cloned
						</label>
						<span style="flex:1;"></span>
						<button
							class="btn btn-sm btn-primary"
							onclick={handlePreview}
							disabled={previewLoading && previewTarget === 'primary'}>
							{#if previewLoading && previewTarget === 'primary'}
								<span class="omnivoice-spinner"></span> Testing...
							{:else}
								▶ Test
							{/if}
						</button>
					</div>

						{#if isPrimaryClone}
						{#if clonedVoices.length > 0}
							<div class="omnivoice-voice-row">
								<select class="omnivoice-clone-select" style="flex:1;"
									value={primaryVoiceId}
									onchange={(e) => tts.handleTTSVoiceChange(e.currentTarget.value)}>
									{#each clonedVoices as v}
										<option value={v.id}>{v.name}</option>
									{/each}
								</select>
								<button class="btn btn-sm btn-secondary" onclick={() => openCloneModal(false)}>
									Clone New
								</button>
								{#if primaryVoiceId}
									<button class="btn btn-sm btn-danger omnivoice-delete-btn"
										onclick={() => deleteClone(primaryVoiceId.replace('clone:', ''))}
										disabled={cloneDeleting === primaryVoiceId.replace('clone:', '')}>
										{#if cloneDeleting === primaryVoiceId.replace('clone:', '')}...{:else}Delete{/if}
									</button>
								{/if}
							</div>
						{:else}
							<div class="omnivoice-voice-row">
								<span class="omnivoice-no-clones">No cloned voices yet.</span>
								<button class="btn btn-sm btn-primary" onclick={() => openCloneModal(false)}>
									Clone New Voice
								</button>
							</div>
						{/if}
					{:else}
						<div class="omnivoice-design">
							<div class="omnivoice-design-row">
								<span class="omnivoice-design-label">Gender</span>
								{#each GENDERS as g}
									<label class="omnivoice-radio">
										<input type="radio" name="ov-p-gender" value={g}
											checked={primaryDesign.gender === g}
											onchange={() => setPrimaryDesign(g, undefined)} />
										{g}
									</label>
								{/each}
							</div>
							<div class="omnivoice-design-row">
								<span class="omnivoice-design-label">Age</span>
								{#each AGES as a}
									<label class="omnivoice-radio">
										<input type="radio" name="ov-p-age" value={a}
											checked={primaryDesign.age === a}
											onchange={() => setPrimaryDesign(undefined, undefined, a)} />
										{a}
									</label>
								{/each}
							</div>
							<div class="omnivoice-design-row">
								<span class="omnivoice-design-label">Pitch</span>
								{#each PITCHES as p}
									<label class="omnivoice-radio">
										<input type="radio" name="ov-p-pitch" value={p}
											checked={primaryDesign.pitch === p}
											onchange={() => setPrimaryDesign(undefined, p)} />
										{p}
									</label>
								{/each}
							</div>
						</div>
					{/if}

					<div class="omnivoice-design">
						<div class="omnivoice-design-row">
							<span class="omnivoice-design-label">Speed</span>
							<input type="range" min="0.5" max="2.0" step="0.05"
								class="omnivoice-slider"
								value={tts.speechSettings.speed as number ?? 1}
								oninput={(e) => tts.handleTTSSpeedChange(parseFloat(e.currentTarget.value))} />
							<span class="omnivoice-slider-val">{tts.speechSettings.speed as number ?? 1}</span>
						</div>
						<div class="omnivoice-design-row">
							<span class="omnivoice-design-label">Quality</span>
							{#each NUMSTEPS as s}
								<label class="omnivoice-radio">
									<input type="radio" name="ov-p-ns" value={s}
										checked={(tts.speechSettings.numStep as number ?? 32) === s}
										onchange={() => modulesStore.setModuleSetting('speech', 'numStep', s)} />
									{s}
								</label>
							{/each}
						</div>
					</div>
				</div>

				<!-- ── Alternative Voice Card ── -->
				<div class="omnivoice-card">
					<label class="omnivoice-card-label omnivoice-card-toggle">
						<input
							type="checkbox"
							checked={enableAlt}
							onchange={(e) => tts.handleTTSEnableAltLanguage(e.currentTarget.checked)}
						/>
						Alternative Voice
					</label>

					{#if enableAlt}
						<div class="api-key-row">
							<select
								class="api-key-input"
								value={tts.speechSettings.altLanguage as string ?? 'es'}
								onchange={(e) => tts.handleTTSAltLanguageChange(e.currentTarget.value)}
							>
								{#each COMMON_LANGUAGES as lang}
									<option value={lang.code}>{lang.name} ({lang.code})</option>
								{/each}
							</select>
						</div>

						<div class="omnivoice-voice-row">
							<span class="omnivoice-design-label" style="width:auto;flex-shrink:0;">Voice</span>
							<label class="omnivoice-radio">
								<input type="radio" name="ov-a-mode" value="synth"
									checked={!isAltClone}
									onchange={() => {
										altShowClone = false;
										tts.handleTTSAltVoiceChange(pickOmniVoicePreset(altDesign.gender));
									}} />
								Synthetic
							</label>
							<label class="omnivoice-radio">
								<input type="radio" name="ov-a-mode" value="clone"
									checked={isAltClone}
									onchange={() => {
										altShowClone = true;
										const c = clonedVoices[0];
										if (c) tts.handleTTSAltVoiceChange(c.id);
									}} />
								Cloned
							</label>
							<span style="flex:1;"></span>
							<button
								class="btn btn-sm btn-primary"
								onclick={handleAltPreview}
								disabled={previewLoading && previewTarget === 'alt'}>
								{#if previewLoading && previewTarget === 'alt'}
									<span class="omnivoice-spinner"></span> Testing...
								{:else}
									▶ Test
								{/if}
							</button>
						</div>

						{#if isAltClone}
							{#if clonedVoices.length > 0}
								<div class="omnivoice-voice-row">
									<select class="omnivoice-clone-select" style="flex:1;"
										value={altVoiceId}
										onchange={(e) => tts.handleTTSAltVoiceChange(e.currentTarget.value)}>
										{#each clonedVoices as v}
											<option value={v.id}>{v.name}</option>
										{/each}
									</select>
									<button class="btn btn-sm btn-secondary" onclick={() => openCloneModal(true)}>
										Clone New
									</button>
									{#if altVoiceId}
										<button class="btn btn-sm btn-danger omnivoice-delete-btn"
											onclick={() => deleteClone(altVoiceId.replace('clone:', ''))}
											disabled={cloneDeleting === altVoiceId.replace('clone:', '')}>
											{#if cloneDeleting === altVoiceId.replace('clone:', '')}...{:else}Delete{/if}
										</button>
									{/if}
								</div>
							{:else}
								<div class="omnivoice-voice-row">
									<span class="omnivoice-no-clones">No cloned voices yet.</span>
									<button class="btn btn-sm btn-primary" onclick={() => openCloneModal(true)}>
										Clone New Voice
									</button>
								</div>
							{/if}
						{:else}
							<div class="omnivoice-design">
								<div class="omnivoice-design-row">
									<span class="omnivoice-design-label">Gender</span>
									{#each GENDERS as g}
										<label class="omnivoice-radio">
											<input type="radio" name="ov-a-gender" value={g}
												checked={altDesign.gender === g}
												onchange={() => setAltDesign(g, undefined)} />
											{g}
										</label>
									{/each}
								</div>
								<div class="omnivoice-design-row">
									<span class="omnivoice-design-label">Age</span>
									{#each AGES as a}
										<label class="omnivoice-radio">
											<input type="radio" name="ov-a-age" value={a}
												checked={altDesign.age === a}
												onchange={() => setAltDesign(undefined, undefined, a)} />
											{a}
										</label>
									{/each}
								</div>
								<div class="omnivoice-design-row">
									<span class="omnivoice-design-label">Pitch</span>
									{#each PITCHES as p}
										<label class="omnivoice-radio">
											<input type="radio" name="ov-a-pitch" value={p}
												checked={altDesign.pitch === p}
												onchange={() => setAltDesign(undefined, p)} />
											{p}
										</label>
									{/each}
								</div>
							</div>
						{/if}

						<div class="omnivoice-design">
							<div class="omnivoice-design-row">
								<span class="omnivoice-design-label">Speed</span>
								<input type="range" min="0.5" max="2.0" step="0.05"
									class="omnivoice-slider"
									value={(tts.speechSettings.altSpeed as number) ?? (tts.speechSettings.speed as number) ?? 1}
									oninput={(e) => tts.handleTTSAltSpeedChange(parseFloat(e.currentTarget.value))} />
								<span class="omnivoice-slider-val">{(tts.speechSettings.altSpeed as number) ?? (tts.speechSettings.speed as number) ?? 1}</span>
							</div>
							<div class="omnivoice-design-row">
								<span class="omnivoice-design-label">Quality</span>
								{#each NUMSTEPS as s}
									<label class="omnivoice-radio">
										<input type="radio" name="ov-a-ns" value={s}
											checked={((tts.speechSettings.altNumStep as number) ?? (tts.speechSettings.numStep as number) ?? 32) === s}
											onchange={() => modulesStore.setModuleSetting('speech', 'altNumStep', s)} />
										{s}
									</label>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- ── Advanced ── -->
				<div class="omnivoice-card">
					<div class="omnivoice-card-label">Advanced</div>
					<div class="omnivoice-design-grid-2">
						<div class="omnivoice-design-row">
							<span class="omnivoice-design-label">Diversity</span>
							<input type="range" min="0" max="10" step="0.1"
								class="omnivoice-slider"
								value={(tts.speechSettings.positionTemperature as number) ?? 0}
								oninput={(e) => tts.handleTTSPositionTemperatureChange(parseFloat(e.currentTarget.value))} />
							<span class="omnivoice-slider-val">{(tts.speechSettings.positionTemperature as number) ?? 0}</span>
						</div>
						<div class="omnivoice-design-row">
							<span class="omnivoice-design-label">Temperature</span>
							<input type="range" min="0" max="2" step="0.1"
								class="omnivoice-slider"
								value={(tts.speechSettings.classTemperature as number) ?? 0}
								oninput={(e) => tts.handleTTSClassTemperatureChange(parseFloat(e.currentTarget.value))} />
							<span class="omnivoice-slider-val">{(tts.speechSettings.classTemperature as number) ?? 0}</span>
						</div>
					</div>
				</div>

				<!-- ═══════════════════════════════════════════════════════ -->
				<!-- Clone Modal                                               -->
				<!-- ═══════════════════════════════════════════════════════ -->
				{#if showCloneModal}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="omnivoice-modal-backdrop"
						onclick={() => { showCloneModal = false; }}
						onkeydown={(e) => { if (e.key === 'Escape') showCloneModal = false; }}
						role="dialog"
						tabindex="-1"
					>
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div class="omnivoice-modal-card" role="document" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
							<h3 class="omnivoice-modal-title">Clone New Voice</h3>

									<div class="omnivoice-modal-field">
								<label class="omnivoice-modal-label" for="clone-audio">Reference Audio (3–10s, wav/mp3)</label>
								<div class="omnivoice-file-row">
									<label class="btn btn-sm btn-secondary" for="clone-audio">
										{cloneFileName || 'Choose file...'}
									</label>
									<input
										type="file"
										accept="audio/*"
										id="clone-audio"
										class="omnivoice-hidden-input"
										onchange={(e) => {
											cloneRefAudio = e.currentTarget.files?.[0] ?? null;
											cloneFileName = cloneRefAudio?.name ?? '';
										}}
									/>
									{#if cloneFileName}
										<span class="omnivoice-file-name">{cloneFileName}</span>
									{/if}
								</div>
							</div>

						<div class="omnivoice-modal-field">
							<label class="omnivoice-modal-label" for="clone-name">Voice Name</label>
							<input
								type="text"
								id="clone-name"
								class="api-key-input"
								placeholder="e.g. my_voice"
								bind:value={cloneVoiceId}
							/>
						</div>

						<div class="omnivoice-modal-field">
							<label class="omnivoice-modal-label" for="clone-text">Reference Text (required)</label>
							<textarea
								id="clone-text"
								class="api-key-input omnivoice-clone-textarea"
								placeholder="Write the sentence you have recorded in the audio file"
								rows="4"
								bind:value={cloneRefText}
							></textarea>
							<p class="omnivoice-modal-hint">Enter the exact sentence spoken in the audio recording (6–10 seconds).</p>
						</div>

							{#if cloneError}
								<p class="omnivoice-modal-error">{cloneError}</p>
							{/if}

							<div class="omnivoice-modal-actions">
								<button class="btn btn-sm btn-secondary" onclick={() => { showCloneModal = false; }}>
									Cancel
								</button>
								<button class="btn btn-sm btn-primary" onclick={handleCloneVoice} disabled={cloneLoading}>
									{cloneLoading ? 'Cloning...' : 'Clone Voice'}
								</button>
							</div>
						</div>
					</div>
				{/if}
			{/if}
		{/if}
	{/if}
</div>

<style>
	.omnivoice-proxy-hint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.omnivoice-proxy-status {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		white-space: nowrap;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.omnivoice-proxy-cmd {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.omnivoice-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--text-tertiary);
		flex-shrink: 0;
	}
	.omnivoice-dot-ok { background: var(--color-success); }
	.omnivoice-dot-warn { background: var(--color-warning); }
	.omnivoice-dot-err { background: var(--color-error); }

	/* ── Cards ──────────────────────────────────────────── */

	.omnivoice-card {
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 0.75rem;
	}
	.omnivoice-card-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.omnivoice-card-toggle {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-secondary);
		font-weight: 500;
	}
	.omnivoice-card-toggle input { accent-color: var(--accent); }

	/* ── Voice row ──────────────────────────────────────── */

	.omnivoice-voice-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.omnivoice-voice-row .btn { white-space: nowrap; flex-shrink: 0; }

	/* ── Spinner ────────────────────────────────────────── */

	.omnivoice-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: ov-spin 0.6s linear infinite;
		vertical-align: middle;
		margin-right: 2px;
	}
	@keyframes ov-spin { to { transform: rotate(360deg); } }

	/* ── Modal ──────────────────────────────────────────── */

	.omnivoice-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.omnivoice-modal-card {
		background: var(--bg-primary);
		border: 1px solid var(--border-light);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 1.25rem;
		min-width: 360px;
		max-width: 90vw;
	}
	.omnivoice-modal-title {
		margin: 0 0 1rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.omnivoice-modal-field { margin-bottom: 0.75rem; }
	.omnivoice-modal-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-tertiary);
		margin-bottom: 0.3rem;
	}
	.omnivoice-modal-error {
		color: var(--color-error);
		font-size: 0.8rem;
		margin: 0.25rem 0;
	}
	.omnivoice-modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.omnivoice-clone-textarea {
		resize: vertical;
		min-height: 5em;
		width: 100%;
		font-family: inherit;
	}
	.omnivoice-modal-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0.25rem 0 0;
	}

	/* ── Voice Design ──────────────────────────────────── */

	.omnivoice-design {
		margin-top: 0.4rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}
	.omnivoice-design-grid-2 {
		margin-top: 0.4rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.omnivoice-design-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-bottom: 0.3rem;
		flex-wrap: wrap;
	}
	.omnivoice-design-row:last-child { margin-bottom: 0; }
	.omnivoice-design-label {
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--text-tertiary);
		width: 3.2em;
		flex-shrink: 0;
		text-align: right;
	}
	.omnivoice-radio {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		font-size: 0.72rem;
		color: var(--text-secondary);
		cursor: pointer;
		white-space: nowrap;
	}
	.omnivoice-radio input { accent-color: var(--accent); margin: 0; }
	.omnivoice-slider {
		flex: 1;
		height: 4px;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.omnivoice-slider-val {
		font-size: 0.7rem;
		color: var(--text-secondary);
		width: 2.2em;
		text-align: center;
		font-family: var(--font-mono);
	}
	.omnivoice-no-clones { font-size: 0.75rem; color: var(--text-tertiary); flex: 1; }
	.omnivoice-file-name { font-size: 0.75rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.omnivoice-clone-select { font-size: 0.8rem; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid transparent; border-radius: var(--radius-lg); padding: 0.5rem 0.75rem; }
	.omnivoice-clone-select:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px var(--accent-muted); }
	.omnivoice-delete-btn { padding: 0.25rem 0.5rem; }
	.omnivoice-file-row { display: flex; align-items: center; gap: 0.5rem; }
	.omnivoice-hidden-input { display: none; }
</style>

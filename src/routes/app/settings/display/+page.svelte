<script lang="ts">
	import { browser } from '$app/environment';
	import { Icon } from '$lib/components/ui';
	import { displayStore } from '$lib/stores/display.svelte';
	import { backgroundStore, BACKGROUND_PRESETS } from '$lib/stores/background.svelte';

	type ColorMode = 'system' | 'light' | 'dark';
	let colorMode = $state<ColorMode>('system');

	// Load saved mode on init
	$effect(() => {
		if (browser) {
			const saved = localStorage.getItem('colorMode') as ColorMode | null;
			if (saved && ['system', 'light', 'dark'].includes(saved)) {
				colorMode = saved;
			}
			applyColorMode(colorMode);
		}
	});

	function setColorMode(mode: ColorMode) {
		colorMode = mode;
		if (browser) {
			localStorage.setItem('colorMode', mode);
			applyColorMode(mode);
		}
	}

	function applyColorMode(mode: ColorMode) {
		if (!browser) return;

		let shouldBeDark: boolean;
		if (mode === 'system') {
			shouldBeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		} else {
			shouldBeDark = mode === 'dark';
		}

		const root = document.documentElement;
		root.classList.toggle('dark', shouldBeDark);
		// Sync data-docs-theme for docs/blog pages
		if (mode === 'system') {
			root.removeAttribute('data-docs-theme');
		} else {
			root.setAttribute('data-docs-theme', mode);
		}
	}

	// System theme change listener lives in +layout.svelte (always mounted)

	// ── Custom background upload ─────────────────────────────────────────────
	let dragOver = $state(false);

	function handleFileInput(file: File) {
		const name = file.name.toLowerCase();
		const isHdr = name.endsWith('.hdr');
		const isExr = name.endsWith('.exr');

		// For HDR/EXR: read as ArrayBuffer and store as data URL with filename hint
		if (isHdr || isExr) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const result = e.target?.result as string;
				if (result) {
					// Embed filename in the data URL comment so Scene knows the format
					const tagged = result.replace('base64,', `filename=${file.name};base64,`);
					backgroundStore.setPreset('custom');
					backgroundStore.setCustomUrl(tagged);
				}
			};
			reader.readAsDataURL(file);
			return;
		}

		if (!file.type.startsWith('image/')) return;
		const reader = new FileReader();
		reader.onload = (e) => {
			const result = e.target?.result as string;
			if (result) {
				backgroundStore.setPreset('custom');
				backgroundStore.setCustomUrl(result);
			}
		};
		reader.readAsDataURL(file);
	}

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) handleFileInput(file);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) handleFileInput(file);
	}

	function stepDelay(delta: number) {
		const current = displayStore.typingIndicatorDelayMs / 1000;
		const next = Math.round((current + delta) * 10) / 10;
		displayStore.setTypingIndicatorDelayMs(Math.max(0, Math.min(10, next)) * 1000);
	}</script>

<div class="page">
	<header class="page-header">
		<h2>Display</h2>
		<p>Appearance and display settings.</p>
	</header>

	<div class="sections">
		<!-- Color Mode Selector -->
		<section class="section">
			<h3>Mode</h3>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Appearance</span>
					<span class="setting-desc">Choose light, dark, or match your system</span>
				</div>
				<div class="mode-selector">
					<button
						class="mode-option"
						class:active={colorMode === 'system'}
						onclick={() => setColorMode('system')}
					>
						<Icon name="monitor" size={16} />
						<span>System</span>
					</button>
					<button
						class="mode-option"
						class:active={colorMode === 'light'}
						onclick={() => setColorMode('light')}
					>
						<Icon name="sun" size={16} />
						<span>Light</span>
					</button>
					<button
						class="mode-option"
						class:active={colorMode === 'dark'}
						onclick={() => setColorMode('dark')}
					>
						<Icon name="moon" size={16} />
						<span>Dark</span>
					</button>
				</div>
			</div>
		</section>

		<!-- Camera Settings -->
		<section class="section">
			<h3>Camera</h3>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Starting Zoom</span>
					<span class="setting-desc">Adjust the default camera distance from the model</span>
				</div>
				<div class="slider-container">
					<span class="slider-label">Close</span>
					<input
						type="range"
						min="1"
						max="4"
						step="0.1"
						value={displayStore.cameraDistance}
						oninput={(e) => displayStore.setCameraDistance(parseFloat(e.currentTarget.value))}
						class="zoom-slider"
					/>
					<span class="slider-label">Far</span>
					<span class="slider-value">{displayStore.cameraDistance.toFixed(1)}</span>
				</div>
			</div>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Horizontal</span>
					<span class="setting-desc">Shift the camera view left or right</span>
				</div>
				<div class="slider-container">
					<span class="slider-label">L</span>
					<input
						type="range"
						min="-2"
						max="2"
						step="0.05"
						value={displayStore.cameraOffsetX}
						oninput={(e) => displayStore.setCameraOffsetX(parseFloat(e.currentTarget.value))}
						class="zoom-slider"
					/>
					<span class="slider-label">R</span>
					<span class="slider-value">{displayStore.cameraOffsetX.toFixed(2)}</span>
				</div>
			</div>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Vertical</span>
					<span class="setting-desc">Shift the camera view up or down</span>
				</div>
				<div class="slider-container">
					<span class="slider-label">D</span>
					<input
						type="range"
						min="-1.5"
						max="1.5"
						step="0.05"
						value={displayStore.cameraOffsetY}
						oninput={(e) => displayStore.setCameraOffsetY(parseFloat(e.currentTarget.value))}
						class="zoom-slider"
					/>
					<span class="slider-label">U</span>
					<span class="slider-value">{displayStore.cameraOffsetY.toFixed(2)}</span>
				</div>
			</div>
			{#if displayStore.cameraOffsetX !== 0 || displayStore.cameraOffsetY !== 0}
				<div class="setting-row camera-reset-row">
					<button class="camera-reset-btn" onclick={() => displayStore.resetCameraPosition()}>
						Reset Position
					</button>
				</div>
			{/if}
		</section>

		<!-- Chat Display Mode -->
		<section class="section">
			<h3>Chat Display</h3>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Mode</span>
					<span class="setting-desc">How the companion's responses are shown</span>
				</div>
				<div class="mode-selector">
					<button
						class="mode-option"
						class:active={displayStore.chatDisplayMode === 'bubble'}
						onclick={() => displayStore.setChatDisplayMode('bubble')}
					>
						<Icon name="message-circle" size={16} />
						<span>Bubble</span>
					</button>
					<button
						class="mode-option"
						class:active={displayStore.chatDisplayMode === 'sidebar'}
						onclick={() => displayStore.setChatDisplayMode('sidebar')}
					>
						<Icon name="message-square" size={16} />
						<span>Sidebar</span>
					</button>
					<button
						class="mode-option"
						class:active={displayStore.chatDisplayMode === 'both'}
						onclick={() => displayStore.setChatDisplayMode('both')}
					>
						<Icon name="layout" size={16} />
						<span>Both</span>
					</button>
					<button
						class="mode-option"
						class:active={displayStore.chatDisplayMode === 'off'}
						onclick={() => displayStore.setChatDisplayMode('off')}
					>
						<Icon name="eye-slash" size={16} />
						<span>Aus</span>
					</button>
				</div>
			</div>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Typing Indicator Delay</span>
					<span class="setting-desc">Wartezeit bevor die 3 Punkte erscheinen</span>
				</div>
				<div class="delay-input-container">
					<button class="delay-step" onclick={() => stepDelay(-0.1)} disabled={displayStore.typingIndicatorDelayMs <= 0}>−</button>
					<input
						type="number"
						class="delay-input"
						min="0"
						max="10"
						step="0.1"
						value={(displayStore.typingIndicatorDelayMs / 1000).toFixed(1)}
						oninput={(e) => displayStore.setTypingIndicatorDelayMs(parseFloat(e.currentTarget.value) * 1000)}
					/>
					<span class="delay-unit">s</span>
					<button class="delay-step" onclick={() => stepDelay(0.1)} disabled={displayStore.typingIndicatorDelayMs >= 10000}>+</button>
				</div>
			</div>
			<div class="setting-row">
				<div class="setting-info">
					<span class="setting-label">Wait tone</span>
					<span class="setting-desc">Sanfter Ton während der Companion denkt</span>
				</div>
				<label class="toggle">
					<input
						type="checkbox"
						checked={displayStore.waitToneEnabled}
						onchange={(e) => displayStore.setWaitToneEnabled(e.currentTarget.checked)}
					/>
					<span class="toggle-track">
						<span class="toggle-thumb"></span>
					</span>
				</label>
			</div>
		</section>

		<!-- Background Picker -->
		<section class="section">
			<h3>Background</h3>
			<div class="bg-grid">
				{#each BACKGROUND_PRESETS as preset}
					<button
						class="bg-swatch"
						class:active={backgroundStore.activePresetId === preset.id}
						class:custom-swatch={preset.id === 'custom'}
						title={preset.label}
						onclick={() => backgroundStore.setPreset(preset.id)}
						style={preset.id !== 'custom' ? `background: ${preset.preview};` : ''}
					>
						{#if preset.id === 'custom'}
							<span class="custom-swatch-icon">🖼️</span>
							<span class="custom-swatch-text">Custom</span>
						{:else}
							<span class="bg-swatch-label">{preset.emoji}</span>
						{/if}
					</button>
				{/each}
			</div>
			<p class="bg-active-label">{BACKGROUND_PRESETS.find(p => p.id === backgroundStore.activePresetId)?.label ?? ''}</p>
			{#if backgroundStore.activePresetId === 'custom'}
				<div
					class="bg-dropzone"
					class:drag-over={dragOver}
					role="region"
					aria-label="Bild-Upload"
					ondragover={(e) => { e.preventDefault(); dragOver = true; }}
					ondragleave={() => dragOver = false}
					ondrop={onDrop}
				>
					{#if backgroundStore.customUrl}
						<div class="bg-preview-row">
						{#if backgroundStore.customUrl.includes('filename=') }
							<div class="bg-thumb bg-thumb-hdr">🌅 HDR/EXR</div>
						{:else}
							<img class="bg-thumb" src={backgroundStore.customUrl} alt="Vorschau" />
						{/if}
							<button class="bg-clear-btn" onclick={() => backgroundStore.setCustomUrl('')}>✕ Entfernen</button>
						</div>
					{:else}
						<label class="bg-upload-label">
							<input type="file" accept="image/*" class="bg-file-input" onchange={onFileChange} />
							<span class="bg-upload-icon">📁</span>
							<span class="bg-upload-text">Datei auswählen oder hierher ziehen</span>
							<span class="bg-upload-hint">PNG, JPG, WEBP, GIF — oder HDR/EXR per URL</span>
						</label>
					{/if}
					<div class="bg-url-row">
						<input
							class="bg-url-input"
							type="url"
							placeholder="…oder URL eingeben (https://…)"
							value={backgroundStore.customUrl.startsWith('data:') ? '' : backgroundStore.customUrl}
							oninput={(e) => backgroundStore.setCustomUrl((e.target as HTMLInputElement).value)}
						/>
					</div>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		height: 100%;
		max-width: 640px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.page-header {
		margin-bottom: 1.5rem;
		flex-shrink: 0;
	}

	.page-header h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.page-header p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.875rem;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		padding-bottom: 1rem;
	}

	.section h3 {
		margin: 0 0 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .setting-row {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.setting-label {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-primary);
	}

	.setting-desc {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* Mode Selector - Skeuomorphic */
	.mode-selector {
		display: flex;
		background: linear-gradient(180deg, #e8e8e8 0%, #d8d8d8 100%);
		border-radius: 12px;
		padding: 4px;
		gap: 3px;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.08),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .mode-selector {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.mode-option {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		background: transparent;
		border: none;
		border-radius: 9px;
		color: var(--text-tertiary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	.mode-option:hover:not(.active) {
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.5);
	}

	:global(.dark) .mode-option:hover:not(.active) {
		background: rgba(255, 255, 255, 0.05);
	}

	.mode-option.active {
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		color: var(--text-primary);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.12),
			0 1px 2px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .mode-option.active {
		background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.3),
			0 1px 2px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	/* Delay Input */
	.delay-input-container {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.delay-step {
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: linear-gradient(180deg, #ffffff 0%, #ebebeb 100%);
		color: var(--text-primary);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		transition: box-shadow 0.1s, transform 0.1s;
	}

	.delay-step:hover:not(:disabled) {
		background: linear-gradient(180deg, #f5f5f5 0%, #e0e0e0 100%);
	}

	.delay-step:active:not(:disabled) {
		transform: translateY(1px);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), inset 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.delay-step:disabled {
		opacity: 0.35;
		cursor: default;
	}

	:global(.dark) .delay-step {
		background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
		border-color: rgba(255, 255, 255, 0.12);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
	}

	:global(.dark) .delay-step:hover:not(:disabled) {
		background: linear-gradient(180deg, #444 0%, #333 100%);
	}

	.delay-input {
		width: 3.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		font-size: 0.875rem;
		color: var(--text-primary);
		text-align: center;
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
		appearance: textfield;
		-moz-appearance: textfield;
	}

	.delay-input::-webkit-outer-spin-button,
	.delay-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
	}

	:global(.dark) .delay-input {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.12);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.delay-unit {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	/* Toggle switch */
	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 22px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-track {
		display: block;
		width: 100%;
		height: 100%;
		background: linear-gradient(180deg, #d0d0d0 0%, #e0e0e0 100%);
		border-radius: 11px;
		transition: all 0.2s ease-out;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.15),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .toggle-track {
		background: linear-gradient(180deg, #1a1a1a 0%, #252525 100%);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.toggle input:checked ~ .toggle-track {
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.8),
			0 2px 8px rgba(1, 178, 255, 0.3);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border-radius: 50%;
		transition: transform 0.2s ease-out;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		pointer-events: none;
	}

	.toggle input:checked ~ .toggle-track .toggle-thumb {
		transform: translateX(18px);
	}

	/* Slider - Skeuomorphic */
	.slider-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.slider-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.slider-value {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		min-width: 2.8rem;
		text-align: right;
	}

	.camera-reset-row {
		justify-content: flex-end;
	}

	.camera-reset-btn {
		font-size: 0.78rem;
		padding: 0.25rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--color-border, #ccc);
		background: var(--bg-secondary);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.camera-reset-btn:hover {
		background: var(--bg-tertiary);
	}

	.zoom-slider {
		width: 120px;
		height: 8px;
		appearance: none;
		background: linear-gradient(180deg, #d0d0d0 0%, #e0e0e0 100%);
		border-radius: 4px;
		cursor: pointer;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.15),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .zoom-slider {
		background: linear-gradient(180deg, #1a1a1a 0%, #252525 100%);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.zoom-slider::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border-radius: 50%;
		cursor: pointer;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
		transition: transform 0.1s ease-out;
	}

	.zoom-slider::-webkit-slider-thumb:hover {
		transform: scale(1.1);
	}

	.zoom-slider::-moz-range-thumb {
		width: 20px;
		height: 20px;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border: none;
		border-radius: 50%;
		cursor: pointer;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	/* Tablet and below */
	@media (max-width: 640px) {
		.page-header {
			margin-bottom: 1rem;
		}

		.page-header h2 {
			font-size: 1.25rem;
		}

		.sections {
			gap: 1.25rem;
		}

		.section h3 {
			margin-bottom: 0.75rem;
		}
	}

	/* Mobile */
	@media (max-width: 520px) {
		.setting-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.mode-selector {
			align-self: stretch;
		}

		.mode-option {
			flex: 1;
			justify-content: center;
		}

		.slider-container {
			width: 100%;
		}

		.zoom-slider {
			flex: 1;
		}
	}

	/* Background Picker */
	.bg-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.bg-swatch {
		aspect-ratio: 1;
		border-radius: 8px;
		border: 2px solid transparent;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4px;
		transition: border-color 0.15s, transform 0.1s;
		outline: none;
	}

	.bg-swatch:hover {
		transform: scale(1.07);
	}

	.bg-swatch.active {
		border-color: var(--color-primary, #6c63ff);
		box-shadow: 0 0 0 2px var(--color-primary, #6c63ff);
	}

	.bg-swatch-label {
		font-size: 1rem;
		line-height: 1;
		filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4));
	}

	.bg-active-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #888);
		margin-top: 0.35rem;
		text-align: center;
	}

	.bg-url-input {
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border, #ccc);
		border-radius: 6px;
		font-size: 0.85rem;
		background: var(--color-surface, #fff);
		color: var(--color-text, #000);
	}

	.custom-swatch {
		background: var(--bg-secondary, #f0f0f0) !important;
		border: 2px dashed var(--color-border, #aaa) !important;
		flex-direction: column;
		gap: 2px;
	}

	.custom-swatch-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	.custom-swatch-text {
		font-size: 0.55rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-secondary, #666);
		line-height: 1;
	}

	.custom-swatch.active {
		border-style: solid !important;
	}

	.bg-dropzone {
		margin-top: 0.6rem;
		border: 2px dashed var(--color-border, #bbb);
		border-radius: 10px;
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		transition: border-color 0.15s, background 0.15s;
	}

	.bg-dropzone.drag-over {
		border-color: var(--color-primary, #6c63ff);
		background: color-mix(in srgb, var(--color-primary, #6c63ff) 8%, transparent);
	}

	.bg-upload-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		cursor: pointer;
		padding: 0.6rem;
	}

	.bg-file-input {
		display: none;
	}

	.bg-upload-icon {
		font-size: 1.6rem;
	}

	.bg-upload-text {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary, #333);
	}

	.bg-upload-hint {
		font-size: 0.72rem;
		color: var(--text-tertiary, #999);
	}

	.bg-preview-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.bg-thumb {
		width: 64px;
		height: 40px;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid var(--color-border, #ddd);
	}

	.bg-thumb-hdr {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 600;
		background: linear-gradient(135deg, #1a1a2e, #0f3460);
		color: #fff;
		width: 64px;
		height: 40px;
	}

	.bg-clear-btn {
		font-size: 0.78rem;
		color: var(--text-secondary, #888);
		background: none;
		border: 1px solid var(--color-border, #ccc);
		border-radius: 5px;
		padding: 0.2rem 0.5rem;
		cursor: pointer;
	}

	.bg-clear-btn:hover {
		color: #e55;
		border-color: #e55;
	}

	.bg-url-row {
		display: flex;
		gap: 0.4rem;
	}

</style>

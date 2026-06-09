<script lang="ts">
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import VrmScene from '$lib/components/vrm/VrmScene.svelte';
	import { Icon } from '$lib/components/ui';
	import * as THREE from 'three';
	import localforage from 'localforage';
	import { debugEventsStore, testEvents } from '$lib/stores/debugEvents.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		EMOTION_TAGS,
		getEmotionVrmExpression,
		getKnownActionTags
	} from '$lib/utils/sentences';
	import { DEFAULT_EMOTION_MAPPINGS } from '$lib/services/vrm/expression-controller';

	// Material debug modes from @pixiv/three-vrm-materials-mtoon
	const materialDebugModes = [
		{ id: 'none', name: 'None (Normal Rendering)' },
		{ id: 'normal', name: 'Normals' },
		{ id: 'litShadeRate', name: 'Lit/Shade Rate' },
		{ id: 'uv', name: 'UV Coordinates' }
	];

	let currentDebugMode = $state('none');

	// Apply debug mode to all MToon materials in the VRM
	function setMaterialDebugMode(mode: string) {
		currentDebugMode = mode;
		const vrm = vrmStore.vrm;
		if (!vrm) return;

		vrm.scene.traverse((obj) => {
			if (obj instanceof THREE.Mesh && obj.material) {
				const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
				for (const mat of materials) {
					// Check if it's an MToon material (has debugMode property)
					if ('debugMode' in mat) {
						(mat as any).debugMode = mode;
						mat.needsUpdate = true;
					}
				}
			}
		});
	}

	// Expression categories for organization
	const expressionCategories = {
		eyes: [
			'eyeBlinkLeft',
			'eyeBlinkRight',
			'eyeLookDownLeft',
			'eyeLookDownRight',
			'eyeLookInLeft',
			'eyeLookInRight',
			'eyeLookOutLeft',
			'eyeLookOutRight',
			'eyeLookUpLeft',
			'eyeLookUpRight',
			'eyeSquintLeft',
			'eyeSquintRight',
			'eyeWideLeft',
			'eyeWideRight'
		],
		brows: [
			'browDownLeft',
			'browDownRight',
			'browInnerUp',
			'browOuterUpLeft',
			'browOuterUpRight'
		],
		mouth: [
			'jawForward',
			'jawLeft',
			'jawRight',
			'jawOpen',
			'mouthClose',
			'mouthFunnel',
			'mouthPucker',
			'mouthLeft',
			'mouthRight',
			'mouthSmileLeft',
			'mouthSmileRight',
			'mouthFrownLeft',
			'mouthFrownRight',
			'mouthDimpleLeft',
			'mouthDimpleRight',
			'mouthStretchLeft',
			'mouthStretchRight',
			'mouthRollLower',
			'mouthRollUpper',
			'mouthShrugLower',
			'mouthShrugUpper',
			'mouthPressLeft',
			'mouthPressRight',
			'mouthLowerDownLeft',
			'mouthLowerDownRight',
			'mouthUpperUpLeft',
			'mouthUpperUpRight'
		],
		lookAt: [
		],
		other: [
			'cheekPuff',
			'cheekSquintLeft',
			'cheekSquintRight',
			'noseSneerLeft',
			'noseSneerRight',
			'tongueOut',
			'neutral',
			'happy',
			'angry',
			'sad',
			'relaxed',
			'surprised'
		]
	};

	// Track expression values
	let expressionValues = $state<Record<string, number>>({});

	// Track which emotion tag last activated each expression.
	// Used so multiple emotion buttons mapping to the same expression
	// don't all appear active at once.
	let activeEmotionForExpression = $state<Record<string, string>>({});

	// Use stored expressions (persists across navigation)
	let availableExpressions = $derived(vrmStore.availableExpressions);

	// Filter categories to only show available expressions
	function getAvailableInCategory(category: string[]): string[] {
		return category.filter((name) => availableExpressions.includes(name));
	}

	// Set expression value — when value > 0, mark as developer override so
	// automatic systems (blink, lip-sync, emotion controller) don't overwrite it.
	function setExpression(name: string, value: number) {
		expressionValues[name] = value;
		const vrm = vrmStore.vrm;
		if (vrm?.expressionManager) {
			try {
				vrm.expressionManager.setValue(name, value);
				vrm.expressionManager.update();
			} catch {
				// Expression doesn't exist
			}
		}
		vrmStore.setDeveloperExpressionOverride(name, value);
	}

	// Direct lookAt control (works for both VRM 0.x and VRM 1.0).
	// VRM 0.x may have lookUp/Down/Left/Right expressions, VRM 1.0 uses bone-based LookAt.
	function setLookAtDirection(name: string, value: number) {
		expressionValues[name] = value;
		const vrm = vrmStore.vrm;
		if (!vrm?.lookAt) return;
		let pitch = vrm.lookAt.pitch;
		let yaw = vrm.lookAt.yaw;
		if (name === 'lookUp') pitch = -30 * value;
		else if (name === 'lookDown') pitch = 30 * value;
		else if (name === 'lookLeft') yaw = 30 * value;
		else if (name === 'lookRight') yaw = -30 * value;
		vrm.lookAt.pitch = pitch;
		vrm.lookAt.yaw = yaw;
		if (value > 0) {
			vrmStore.setDeveloperExpressionOverride(name, value);
		} else {
			vrmStore.setDeveloperExpressionOverride(name, 0);
		}
	}

	// Toggle an expression on/off (used by Detected Model Expression tags).
	// If currently active (>0), deactivate. If inactive, activate at full intensity.
	function toggleExpression(name: string) {
		const currentValue = expressionValues[name] || 0;
		if (currentValue > 0) {
			setExpression(name, 0);
		} else {
			setExpression(name, 1);
		}
	}

	// Reset all expressions, lookAt, and clear developer overrides
	function resetAll() {
		const vrm = vrmStore.vrm;
		if (vrm?.expressionManager) {
			for (const name of availableExpressions) {
				vrm.expressionManager.setValue(name, 0);
				expressionValues[name] = 0;
			}
			vrm.expressionManager.update();
		}
		if (vrm?.lookAt) {
			vrm.lookAt.reset();
			vrm.lookAt.update(0);
			expressionValues['lookUp'] = 0;
			expressionValues['lookDown'] = 0;
			expressionValues['lookLeft'] = 0;
			expressionValues['lookRight'] = 0;
		}
		vrmStore.clearDeveloperExpressionOverrides();
		activeEmotionForExpression = {};
	}

	// Clean up overrides when leaving the developer page
	onDestroy(() => {
		vrmStore.clearDeveloperExpressionOverrides();
	});

	// ── Expression Presets ──

	interface Preset {
		name: string;
		exprs: Record<string, number>;
		duration: number;
	}

	const presets: Preset[] = [
		{
			name: 'Test Blink',
			exprs: { eyeBlinkLeft: 1, eyeBlinkRight: 1 },
			duration: 150
		},
		{
			name: 'Test Smile',
			exprs: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.3, cheekSquintRight: 0.3 },
			duration: 1000
		},
		{
			name: 'Test Surprised',
			exprs: { eyeWideLeft: 0.8, eyeWideRight: 0.8, browInnerUp: 0.7, browOuterUpLeft: 0.5, browOuterUpRight: 0.5, jawOpen: 0.4 },
			duration: 1000
		},
		{
			name: 'Test Sad',
			exprs: { browInnerUp: 0.6, browDownLeft: 0.3, browDownRight: 0.3, mouthFrownLeft: 0.5, mouthFrownRight: 0.5 },
			duration: 1000
		},
		{
			name: 'Test Mouth Open',
			exprs: { jawOpen: 0.7 },
			duration: 500
		}
	];

	function isPresetAvailable(preset: Preset): boolean {
		return Object.keys(preset.exprs).every((name) => availableExpressions.includes(name));
	}

	function runPreset(preset: Preset) {
		for (const [name, value] of Object.entries(preset.exprs)) {
			setExpression(name, value);
		}
		setTimeout(() => {
			for (const name of Object.keys(preset.exprs)) {
				setExpression(name, 0);
			}
		}, preset.duration);
	}

	// ── Emotion Tag Tests (dynamic, based on loaded model) ──

	/** Check whether the VRM expression mapped to an emotion tag is available on the current model.
	 *  Respects the active per-model emotion profile first, then falls back to default mappings. */
	function isEmotionAvailable(emotion: string): boolean {
		const profile = vrmStore.emotionProfile;
		const mappedExpr = profile?.[emotion]?.expression;
		if (mappedExpr) return availableExpressions.includes(mappedExpr);
		const expr = getEmotionVrmExpression(emotion);
		return !!expr && availableExpressions.includes(expr);
	}

	/** Get intensity for an emotion (from active profile or defaults). */
	function getEmotionIntensity(emotion: string): number {
		const profile = vrmStore.emotionProfile;
		return profile?.[emotion]?.intensity ?? DEFAULT_EMOTION_MAPPINGS[emotion]?.intensity ?? 0.7;
	}

	/** Toggle an emotion expression on/off.
	 *  Uses the per-model emotion profile so custom mappings are honoured.
	 *  Active emotions are highlighted and protected from automatic systems.
	 *  Only one emotion per expression can be active at a time. */
	function toggleEmotion(emotion: string) {
		const profile = vrmStore.emotionProfile;
		const mapping = profile?.[emotion];
		const expr = mapping?.expression || getEmotionVrmExpression(emotion);
		if (!expr || !availableExpressions.includes(expr)) return;
		const intensity = mapping?.intensity ?? DEFAULT_EMOTION_MAPPINGS[emotion]?.intensity ?? 0.7;
		const currentActive = activeEmotionForExpression[expr];
		if (currentActive === emotion) {
			// Deactivate this emotion
			setExpression(expr, 0);
			activeEmotionForExpression = { ...activeEmotionForExpression, [expr]: '' };
		} else {
			// Activate this emotion (replaces any other emotion using the same expression)
			setExpression(expr, intensity);
			activeEmotionForExpression = { ...activeEmotionForExpression, [expr]: emotion };
		}
	}

	/** All known emotion tags, sorted alphabetically. */
	const knownEmotions = Object.keys(EMOTION_TAGS).sort();

	// ── Action Tests ──

	const knownActions = getKnownActionTags().sort();

	function isActionAvailable(action: string): boolean {
		const anim = vrmStore.availableAnimations.find((a) => a.id === action);
		return anim?.missing !== true;
	}

	function testAction(action: string) {
		vrmStore.triggerAction(action);
	}

	// Clear all VRM storage (IndexedDB)
	let clearingStorage = $state(false);
	async function clearVrmStorage() {
		clearingStorage = true;
		try {
			const vrmStorage = localforage.createInstance({
				name: 'utsuwa-vrm',
				storeName: 'models'
			});
			await vrmStorage.clear();
			// Reload to reset state
			window.location.reload();
		} catch (e) {
			console.error('Failed to clear VRM storage:', e);
		}
		clearingStorage = false;
	}

	// Trigger a test event
	async function triggerEvent(event: typeof testEvents[0]) {
		debugEventsStore.trigger(event);
		// Navigate to home to show the event
		await goto('/app');
	}

	// ── Custom Animation Upload ──

	let uploadingAnimation = $state(false);
	let pendingUploadFile: File | null = $state(null);
	let pendingUploadName = $state('');
	let uploadNameInput: HTMLInputElement | null = $state(null);

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !file.name.endsWith('.vrma')) return;

		pendingUploadFile = file;
		pendingUploadName = file.name.replace(/\.vrma$/i, '');
		input.value = ''; // reset so same file can be selected again

		// Focus the name input on next tick
		queueMicrotask(() => uploadNameInput?.focus());
	}

	async function confirmUpload() {
		if (!pendingUploadFile) return;
		const name = pendingUploadName.trim();
		if (!name) return;

		uploadingAnimation = true;
		try {
			await vrmStore.addAnimation(pendingUploadFile, name);
		} catch (err) {
			console.error('Failed to upload animation:', err);
		}
		uploadingAnimation = false;
		pendingUploadFile = null;
		pendingUploadName = '';
	}

	function cancelUpload() {
		pendingUploadFile = null;
		pendingUploadName = '';
	}

	async function removeCustomAnimation(id: string) {
		try {
			await vrmStore.removeAnimation(id);
		} catch (err) {
			console.error('Failed to remove animation:', err);
		}
	}

	// Clear all character data
	async function clearCharacterData() {
		try {
			indexedDB.deleteDatabase('utsuwa-db');
			window.location.reload();
		} catch (e) {
			console.error('Failed to clear character data:', e);
		}
	}
</script>

<div class="developer-settings">
	<div class="dev-header">
		<div>
			<h2>Developer Tools</h2>
			<p class="description">Test and debug VRM facial expressions and animations.</p>
		</div>
	</div>

	<div class="dev-layout">
		<!-- Viewport -->
		<div class="viewport-container">
			<div class="viewport">
				<VrmScene centered />
			</div>
			<div class="viewport-controls">
				<button class="viewport-btn" onclick={resetAll} title="Reset expressions">
					<Icon name="refresh-cw" size={16} />
					Reset
				</button>
			</div>
		</div>

		<!-- Controls Panel -->
		<div class="controls-panel">
			<!-- Animation Selection -->
			<section class="section">
				<h3>Animation</h3>
				<p class="hint">Select a motion clip to play on the model. Idle animations run automatically.</p>
				<div class="animation-select">
					<select
						value={vrmStore.currentAnimation || 'none'}
						onchange={(e) => vrmStore.setCurrentAnimation(e.currentTarget.value === 'none' ? null : e.currentTarget.value)}
					>
						<option value="none">— None (Idle) —</option>
						{#each vrmStore.availableAnimations.filter((a) => a.missing !== true && !a.id.startsWith('idle') && a.id !== 'talking') as anim}
							<option value={anim.id}>{anim.name}</option>
						{/each}
					</select>
				</div>

				<!-- Custom Animation Upload -->
				<div class="upload-section">
					<p class="hint">Upload your own .vrma files to extend the animation library.</p>
					{#if pendingUploadFile}
						<div class="upload-name-dialog">
							<label for="upload-name">Animation name:</label>
							<input
								id="upload-name"
								type="text"
								bind:this={uploadNameInput}
								bind:value={pendingUploadName}
								onkeydown={(e) => {
									if (e.key === 'Enter') confirmUpload();
									if (e.key === 'Escape') cancelUpload();
								}}
							/>
							<div class="upload-name-actions">
								<button
									class="btn-confirm"
									disabled={uploadingAnimation || !pendingUploadName.trim()}
									onclick={confirmUpload}
								>
									{uploadingAnimation ? 'Uploading...' : 'Confirm'}
								</button>
								<button class="btn-cancel" onclick={cancelUpload} disabled={uploadingAnimation}>
									Cancel
								</button>
							</div>
						</div>
					{:else}
						<label class="upload-btn">
							<Icon name="upload" size={14} />
							Upload VRMA
							<input
								type="file"
								accept=".vrma"
								onchange={handleFileSelect}
								style="display: none;"
							/>
						</label>
					{/if}
				</div>

				<!-- Custom Animation List -->
				{#if vrmStore.customAnimations.length > 0}
					<div class="custom-animations">
						<p class="hint">Your uploaded animations:</p>
						<div class="anim-list">
							{#each vrmStore.customAnimations as anim}
								<div class="anim-row">
									<span class="anim-name">{anim.name}</span>
									<button
										class="anim-remove"
										onclick={() => removeCustomAnimation(anim.id)}
										title="Remove"
									>
										×
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</section>

			<!-- Material Debug -->
			<section class="section">
				<h3>Material Debug</h3>
				<p class="hint">Visualize different material properties (MToon).</p>
				<div class="animation-select">
					<select
						value={currentDebugMode}
						onchange={(e) => setMaterialDebugMode(e.currentTarget.value)}
					>
						{#each materialDebugModes as mode}
							<option value={mode.id}>{mode.name}</option>
						{/each}
					</select>
				</div>
			</section>

			<!-- Expression Presets (formerly Quick Tests) -->
			<section class="section">
				<h3>Expression Presets</h3>
				<p class="hint">Pre-configured combinations of multiple expressions that create a recognizable overall expression. Presets are disabled when this model lacks a required expression.</p>
				<div class="quick-actions">
					{#each presets as preset}
						{@const available = isPresetAvailable(preset)}
						<button
							class="action-btn"
							class:disabled={!available}
							onclick={() => runPreset(preset)}
							disabled={!available}
							title={available ? preset.name : `Missing expressions: ${Object.keys(preset.exprs).filter((n) => !availableExpressions.includes(n)).join(', ')}`}
						>
							{preset.name}
						</button>
					{/each}
					<button class="action-btn reset" onclick={resetAll}>Reset All</button>
				</div>
			</section>

			<!-- Emotion Tags (dynamic, model-specific) -->
			<section class="section">
				<h3>Emotion Tags</h3>
				<p class="hint">
					Click an emotion to activate its expression. Click again to deactivate.
					Active emotions are highlighted. Only emotions whose underlying VRM expression
					is available on this model are enabled.
				</p>
				<div class="quick-actions">
					{#each knownEmotions as emotion}
						{@const available = isEmotionAvailable(emotion)}
						{@const exprName = (() => {
							const profile = vrmStore.emotionProfile;
							const mapping = profile?.[emotion];
							return mapping?.expression || getEmotionVrmExpression(emotion) || '';
						})()}
						{@const isActive = exprName ? activeEmotionForExpression[exprName] === emotion : false}
						<button
							class="action-btn"
							class:missing={!available}
							class:active={available && isActive}
							onclick={() => toggleEmotion(emotion)}
							title={available
								? isActive
									? `Deactivate ${emotion} (${exprName})`
									: `Activate ${emotion} (${exprName} = ${(() => {
											const profile = vrmStore.emotionProfile;
											const mapping = profile?.[emotion];
											return (mapping?.intensity ?? DEFAULT_EMOTION_MAPPINGS[emotion]?.intensity ?? 0.7).toFixed(1);
										})()})`
								: `Expression '${exprName}' not available on this model`}
						>
							{EMOTION_TAGS[emotion].displayText ?? ''} {emotion}
							{#if !available}
								<span class="missing-badge">!</span>
							{/if}
						</button>
					{/each}
				</div>
			</section>

			<!-- Action Tests -->
			<section class="section">
				<h3>Action Tests</h3>
				<p class="hint">Trigger body animations. Actions without a VRMA file are shown as unavailable.</p>
				<div class="quick-actions">
					{#each knownActions as action}
						{@const available = isActionAvailable(action)}
						<button
							class="action-btn"
							class:disabled={!available}
							onclick={() => testAction(action)}
							disabled={!available}
							title={available ? `Trigger ${action}` : `Animation file for '${action}' not found`}
						>
							{action}
						</button>
					{/each}
				</div>
			</section>

			<!-- Events Debug -->
			<section class="section">
				<h3>Event System</h3>
				<p class="hint">Trigger test events to preview the event modal styling.</p>
				<div class="event-buttons">
					{#each testEvents as event}
						<button class="event-btn" onclick={() => triggerEvent(event)}>
							<Icon name={event.type === 'milestone' ? 'sparkles' : event.type === 'anniversary' ? 'calendar' : event.type === 'conditional' ? 'heart' : 'shuffle'} size={14} />
							{event.name}
						</button>
					{/each}
				</div>
			</section>

			<!-- Storage -->
			<section class="section">
				<h3>Storage</h3>
				<p class="hint">Clear cached data from browser storage.</p>
				<div class="quick-actions">
					<button class="action-btn reset" onclick={clearVrmStorage} disabled={clearingStorage}>
						{clearingStorage ? 'Clearing...' : 'Clear VRM Storage'}
					</button>
					<button class="action-btn reset" onclick={clearCharacterData}>
						Reset Character Data
					</button>
				</div>
			</section>

			<!-- Detected Model Expressions (formerly Available Expressions) -->
			<section class="section">
				<h3>Detected Model Expressions ({availableExpressions.length})</h3>
				<p class="hint">
					Click an expression to activate it, click again to deactivate.
					Active expressions are highlighted — they are protected from automatic systems
					(blink, lip-sync, emotion controller). Use Reset to clear all.
				</p>
				<div class="expression-tags">
					{#each availableExpressions as expr}
						{@const isActive = (expressionValues[expr] || 0) > 0}
						<button
							class="tag clickable"
							class:active={isActive}
							onclick={() => toggleExpression(expr)}
							title={isActive ? `Deactivate ${expr}` : `Activate ${expr}`}
							type="button"
						>
							{expr}
						</button>
					{/each}
				</div>
			</section>

			<!-- Expression Sliders by Category -->
			{#each Object.entries(expressionCategories) as [category, expressions]}
				{@const available = getAvailableInCategory(expressions)}
				{#if available.length > 0}
					<section class="section">
						<h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
						<div class="sliders">
							{#each available as expr}
								<div class="slider-row">
									<label for={expr}>{expr}</label>
									<input
										type="range"
										id={expr}
										min="0"
										max="1"
										step="0.01"
										value={expressionValues[expr] || 0}
										oninput={(e) => setExpression(expr, parseFloat(e.currentTarget.value))}
									/>
									<span class="value">{(expressionValues[expr] || 0).toFixed(2)}</span>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			{/each}

			<!-- LookAt Control (always shown when model has LookAt) -->
			{#if vrmStore.vrm?.lookAt}
				<section class="section">
					<h3>LookAt</h3>
					<p class="hint">
						Direct head/eye direction control. Works for both VRM 0.x and VRM 1.0 models.
						VRM 1.0 uses bone-based LookAt; VRM 0.x may use expressions or bones.
					</p>
					<div class="sliders">
						{#each ['lookUp', 'lookDown', 'lookLeft', 'lookRight'] as dir}
							<div class="slider-row">
								<label for={dir}>{dir}</label>
								<input
									type="range"
									id={dir}
									min="0"
									max="1"
									step="0.01"
									value={expressionValues[dir] || 0}
									oninput={(e) => setLookAtDirection(dir, parseFloat(e.currentTarget.value))}
								/>
								<span class="value">{(expressionValues[dir] || 0).toFixed(2)}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.developer-settings {
		max-width: 1400px;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dev-header {
		margin-bottom: 1rem;
	}

	h2 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.description {
		margin: 0;
		color: var(--text-secondary);
	}

	.dev-layout {
		display: grid;
		grid-template-columns: 400px 1fr;
		gap: 1.5rem;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.viewport-container {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.viewport {
		flex: 1;
		min-height: 400px;
		background: linear-gradient(180deg, #f0f0f0 0%, #e5e5e5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		overflow: hidden;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.05),
			0 2px 8px rgba(0, 0, 0, 0.06);
	}

	:global(.dark) .viewport {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.2),
			0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.viewport-controls {
		display: flex;
		gap: 0.5rem;
	}

	.viewport-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .viewport-btn {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.viewport-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .viewport-btn:hover {
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.controls-panel {
		overflow-y: auto;
		min-height: 0;
		padding-right: 0.5rem;
		padding-bottom: 1rem;
	}

	.section {
		margin-bottom: 1.25rem;
		padding: 1.25rem;
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.06),
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .section {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.25),
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.section h3 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.hint {
		margin: 0 0 0.75rem;
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}

	.animation-select select {
		width: 100%;
		padding: 0.75rem 1rem;
		padding-right: 2rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		font-size: 0.875rem;
		color: var(--text-primary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
		background-clip: padding-box;
		color-scheme: light;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.05),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .animation-select select {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.12);
		color: var(--text-primary);
		color-scheme: dark;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.3),
			0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.animation-select select option {
		color: var(--text-primary);
		background: var(--bg-secondary);
	}

	:global(.dark) .animation-select select option {
		color: var(--text-primary);
		background: var(--bg-secondary);
	}

	.animation-select select:hover {
		border-color: rgba(1, 178, 255, 0.4);
	}

	.animation-select select:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow: 0 0 0 3px rgba(1, 178, 255, 0.15);
	}

	.quick-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.action-btn {
		padding: 0.5rem 1rem;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .action-btn {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.action-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .action-btn:hover {
		box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.action-btn.reset {
		background: linear-gradient(180deg, #fff0f0 0%, #ffe5e5 100%);
		border-color: rgba(220, 38, 38, 0.2);
		color: var(--color-red-700);
	}

	:global(.dark) .action-btn.reset {
		background: linear-gradient(180deg, #3a2020 0%, #2a1515 100%);
		border-color: rgba(220, 38, 38, 0.3);
		color: var(--color-red-300);
	}

	.action-btn.active {
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border-color: rgba(1, 178, 255, 0.4);
		color: #01B2FF;
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .action-btn.active {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.5);
		color: #01B2FF;
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.action-btn.missing {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action-btn.missing:hover {
		transform: none;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .action-btn.missing:hover {
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.missing-badge {
		margin-left: 0.25rem;
		font-size: 0.625rem;
		color: var(--color-red-500);
		font-weight: 700;
	}

	:global(.dark) .missing-badge {
		color: var(--color-red-400);
	}

	.action-btn.reset:hover {
		background: linear-gradient(180deg, #ffe5e5 0%, #ffd5d5 100%);
		transform: translateY(-1px);
	}

	:global(.dark) .action-btn.reset:hover {
		background: linear-gradient(180deg, #4a2525 0%, #3a1a1a 100%);
	}

	.action-btn.disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none !important;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
	}

	:global(.dark) .action-btn.disabled {
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
	}

	.event-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.event-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border: 1px solid rgba(1, 178, 255, 0.3);
		border-radius: 10px;
		font-size: 0.875rem;
		font-weight: 500;
		color: #01B2FF;
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .event-btn {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.35);
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.event-btn:hover {
		transform: translateY(-2px);
		box-shadow:
			0 4px 12px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .event-btn:hover {
		box-shadow:
			0 4px 12px rgba(1, 178, 255, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.expression-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tag {
		padding: 0.3rem 0.6rem;
		background: linear-gradient(180deg, #f5f5f5 0%, #ebebeb 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 8px;
		font-size: 0.75rem;
		font-family: 'Share Tech Mono', monospace;
		color: var(--text-secondary);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.04),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .tag {
		background: linear-gradient(180deg, #252525 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.tag.clickable {
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	.tag.clickable:hover {
		transform: translateY(-1px);
		box-shadow:
			0 3px 6px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		border-color: rgba(1, 178, 255, 0.35);
		color: #01B2FF;
	}

	:global(.dark) .tag.clickable:hover {
		box-shadow:
			0 3px 6px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		border-color: rgba(1, 178, 255, 0.45);
	}

	.tag.active {
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border-color: rgba(1, 178, 255, 0.4);
		color: #01B2FF;
		box-shadow:
			0 1px 3px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .tag.active {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.5);
		color: #01B2FF;
		box-shadow:
			0 1px 3px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.sliders {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.slider-row {
		display: grid;
		grid-template-columns: 180px 1fr 50px;
		align-items: center;
		gap: 1rem;
	}

	.slider-row label {
		font-size: 0.8125rem;
		font-family: 'Share Tech Mono', monospace;
		color: var(--text-secondary);
	}

	.slider-row input[type='range'] {
		width: 100%;
		height: 8px;
		background: linear-gradient(180deg, #d0d0d0 0%, #e0e0e0 100%);
		border-radius: 4px;
		outline: none;
		-webkit-appearance: none;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.15),
			0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .slider-row input[type='range'] {
		background: linear-gradient(180deg, #1a1a1a 0%, #252525 100%);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.slider-row input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 18px;
		height: 18px;
		background: linear-gradient(180deg, #4dd0ff 0%, #01B2FF 100%);
		border-radius: 50%;
		cursor: pointer;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
		transition: transform 0.1s ease-out;
	}

	.slider-row input[type='range']::-webkit-slider-thumb:hover {
		transform: scale(1.1);
	}

	.slider-row .value {
		font-size: 0.75rem;
		font-family: 'Share Tech Mono', monospace;
		color: var(--text-tertiary);
		text-align: right;
	}

	/* ── Upload & Custom Animation List ── */

	.upload-section {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
	}

	:global(.dark) .upload-section {
		border-top-color: rgba(255, 255, 255, 0.06);
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(180deg, #e8f7ff 0%, #d8f0ff 100%);
		border: 1px solid rgba(1, 178, 255, 0.3);
		border-radius: 10px;
		font-size: 0.875rem;
		font-weight: 500;
		color: #01B2FF;
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .upload-btn {
		background: linear-gradient(180deg, #1a3040 0%, #152530 100%);
		border-color: rgba(1, 178, 255, 0.35);
		box-shadow:
			0 2px 6px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.upload-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 4px 10px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .upload-btn:hover {
		box-shadow:
			0 4px 10px rgba(1, 178, 255, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.upload-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.upload-name-dialog {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
	}

	:global(.dark) .upload-name-dialog {
		background: linear-gradient(180deg, #252525 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
	}

	.upload-name-dialog label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.upload-name-dialog input[type='text'] {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 6px;
		font-size: 0.875rem;
		font-family: 'Share Tech Mono', monospace;
		background: #fff;
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.15s ease;
	}

	:global(.dark) .upload-name-dialog input[type='text'] {
		background: #1a1a1a;
		border-color: rgba(255, 255, 255, 0.1);
		color: #e0e0e0;
	}

	.upload-name-dialog input[type='text']:focus {
		border-color: var(--accent-primary, #01b2ff);
	}

	.upload-name-actions {
		display: flex;
		gap: 0.5rem;
	}

	.upload-name-actions button {
		flex: 1;
		padding: 0.45rem 0.75rem;
		border: none;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}

	.upload-name-actions button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-confirm {
		background: linear-gradient(180deg, #01b2ff 0%, #0090d4 100%);
		color: #fff;
	}

	.btn-cancel {
		background: linear-gradient(180deg, #e0e0e0 0%, #d0d0d0 100%);
		color: #333;
	}

	:global(.dark) .btn-cancel {
		background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
		color: #e0e0e0;
	}

	.custom-animations {
		margin-top: 0.75rem;
	}

	.anim-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.anim-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 8px;
		font-size: 0.8125rem;
		font-family: 'Share Tech Mono', monospace;
		color: var(--text-secondary);
	}

	:global(.dark) .anim-row {
		background: linear-gradient(180deg, #252525 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.06);
	}

	.anim-remove {
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(180deg, #fff0f0 0%, #ffe5e5 100%);
		border: 1px solid rgba(220, 38, 38, 0.2);
		border-radius: 6px;
		font-size: 1rem;
		line-height: 1;
		color: var(--color-red-700);
		cursor: pointer;
		transition: all 0.15s ease-out;
	}

	:global(.dark) .anim-remove {
		background: linear-gradient(180deg, #3a2020 0%, #2a1515 100%);
		border-color: rgba(220, 38, 38, 0.3);
		color: var(--color-red-300);
	}

	.anim-remove:hover {
		transform: scale(1.1);
	}

	@media (max-width: 900px) {
		.dev-layout {
			grid-template-columns: 1fr;
		}

		.viewport {
			min-height: 300px;
			max-height: 350px;
		}
	}

	@media (max-width: 640px) {
		.dev-header {
			margin-bottom: 0.75rem;
		}

		h2 {
			font-size: 1.25rem;
		}

		.description {
			font-size: 0.875rem;
		}

		.viewport {
			min-height: 240px;
			max-height: 280px;
		}

		.viewport-btn {
			padding: 0.375rem 0.75rem;
			font-size: 0.75rem;
		}

		.section {
			padding: 1rem;
			margin-bottom: 1rem;
		}

		.section h3 {
			font-size: 0.9rem;
			margin-bottom: 0.75rem;
		}

		.hint {
			font-size: 0.8125rem;
			margin-bottom: 0.625rem;
		}

		.quick-actions {
			gap: 0.375rem;
		}

		.action-btn {
			padding: 0.375rem 0.75rem;
			font-size: 0.8125rem;
		}

		.event-buttons {
			gap: 0.375rem;
		}

		.event-btn {
			padding: 0.5rem 0.75rem;
			font-size: 0.8125rem;
		}

		.expression-tags {
			gap: 0.25rem;
		}

		.tag {
			padding: 0.1875rem 0.375rem;
			font-size: 0.6875rem;
		}

		.slider-row {
			grid-template-columns: 1fr 50px;
		}

		.slider-row label {
			grid-column: 1 / -1;
			margin-bottom: -0.5rem;
			font-size: 0.75rem;
		}

		.slider-row .value {
			font-size: 0.6875rem;
		}
	}

	@media (max-width: 400px) {
		.viewport {
			min-height: 200px;
			max-height: 240px;
		}

		.event-btn span {
			display: none;
		}

		.event-btn {
			padding: 0.5rem;
		}
	}
</style>

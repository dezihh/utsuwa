<script lang="ts">
	// Simplified scene matching @pixiv/three-vrm examples exactly
	// https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/main.js
	import { T, useThrelte, useTask } from '@threlte/core';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
	import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
	import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
	import { HemisphereLight, DirectionalLight, ShaderMaterial, Color, BackSide, SRGBColorSpace, ACESFilmicToneMapping, HalfFloatType, PMREMGenerator, CanvasTexture, TextureLoader } from 'three';
	import type { Texture } from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
	import VrmModel from './VrmModel.svelte';
	import OverlayRaycastHandler from '$lib/components/overlay/OverlayRaycastHandler.svelte';
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import { displayStore } from '$lib/stores/display.svelte';
	import { screenshotStore } from '$lib/stores/screenshot.svelte';
	import { backgroundStore } from '$lib/stores/background.svelte';
	import { onMount } from 'svelte';

	// Dot grid shader for background sphere
	const dotGridVertexShader = `
		varying vec2 vUv;
		varying vec3 vNormal;
		void main() {
			vUv = uv;
			vNormal = normal;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`;

	const dotGridFragmentShader = `
		uniform vec3 uBackgroundColor;
		uniform vec3 uDotColor;
		uniform float uDotSize;
		uniform float uSpacingX;
		uniform float uSpacingY;
		varying vec2 vUv;

		void main() {
			// Create grid with separate X and Y spacing for proper circles on sphere
			vec2 grid = fract(vec2(vUv.x * uSpacingX, vUv.y * uSpacingY));
			float dist = length(grid - 0.5);
			float dot = 1.0 - smoothstep(uDotSize - 0.005, uDotSize + 0.005, dist);
			vec3 color = mix(uBackgroundColor, uDotColor, dot);
			gl_FragColor = vec4(color, 1.0);
		}
	`;

	// Design language colors (matching CSS tokens in app.css)
	const SCENE_COLORS = {
		light: {
			background: '#ffffff',
			dot: '#d0d0d0',
			placeholder: '#9ca3af' // text-tertiary equivalent
		},
		dark: {
			background: '#353535',
			dot: '#888888',
			placeholder: '#6b7280'
		}
	};

	// Refs for lights (needed to call setHSL methods)
	let hemiLight = $state<HemisphereLight | undefined>(undefined);
	let dirLight = $state<DirectionalLight | undefined>(undefined);

	// ── Background system ────────────────────────────────────────────────────────

	/** Whether to show the dot-grid sphere (only for dotgrid preset) */
	const showDotGrid = $derived(backgroundStore.activePresetId === 'dot-grid');

	/** Currently loaded background texture — disposed when preset changes */
	let currentBgTexture: Texture | null = null;
	let bgImageLoadAbort: AbortController | null = null;

	/** Create a vertical linear-gradient canvas texture */
	function createGradientTexture(colors: string[]): CanvasTexture {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 512;
		const ctx = canvas.getContext('2d')!;
		const grad = ctx.createLinearGradient(0, 0, 0, 512);
		colors.forEach((c, i) => grad.addColorStop(i / Math.max(colors.length - 1, 1), c));
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 4, 512);
		const tex = new CanvasTexture(canvas);
		tex.colorSpace = SRGBColorSpace;
		return tex;
	}

	function disposeBgTexture() {
		currentBgTexture?.dispose();
		currentBgTexture = null;
	}

	/** Apply the active background preset to scene.background (sync presets only) */
	function applyBackgroundSync() {
		if (!scene || overlay) return;
		const preset = backgroundStore.activePreset;
		const dark = isDarkMode;

		disposeBgTexture();

		if (preset.type === 'dotgrid') {
			scene.background = new Color(dark ? SCENE_COLORS.dark.background : SCENE_COLORS.light.background);
		} else if (preset.type === 'solid') {
			scene.background = new Color(preset.color ?? '#ffffff');
		} else if (preset.type === 'gradient' && preset.colors) {
			const tex = createGradientTexture(preset.colors);
			currentBgTexture = tex;
			scene.background = tex;
		}
		// 'image' is handled async below
	}

	/** Load a background image/HDRI URL and apply it */
	async function loadBackgroundImage(url: string) {
		bgImageLoadAbort?.abort();
		const ac = new AbortController();
		bgImageLoadAbort = ac;

		try {
			const isDataUrl = url.startsWith('data:');

			// Extract embedded filename hint (added by handleFileInput for HDR/EXR uploads)
			const filenameMatch = url.match(/filename=([^;]+);/);
			const embeddedName = filenameMatch?.[1]?.toLowerCase() ?? '';

			const isHdr = /\.hdr$/i.test(url) || embeddedName.endsWith('.hdr');
			const isExr = /\.exr$/i.test(url) || embeddedName.endsWith('.exr');

			let tex: Texture;
			if ((isHdr || isExr) && renderer) {
				const pmrem = new PMREMGenerator(renderer);
				pmrem.compileEquirectangularShader();
				let raw: Texture;
				if (isExr) {
					if (isDataUrl) {
						// EXRLoader can't handle data: URLs — convert to Blob URL
						const base64 = url.replace(/data:[^;]*;(?:filename=[^;]+;)?base64,/, '');
						const binary = atob(base64);
						const buf = new ArrayBuffer(binary.length);
						const view = new Uint8Array(buf);
						for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
						const blob = new Blob([buf], { type: 'application/octet-stream' });
						const blobUrl = URL.createObjectURL(blob);
						try {
							raw = await new EXRLoader().loadAsync(blobUrl) as unknown as Texture;
						} finally {
							URL.revokeObjectURL(blobUrl);
						}
					} else {
						raw = await new EXRLoader().loadAsync(url) as unknown as Texture;
					}
				} else {
					raw = await new RGBELoader().loadAsync(url);
				}
				if (ac.signal.aborted) { raw.dispose(); pmrem.dispose(); return; }
				tex = pmrem.fromEquirectangular(raw).texture;
				raw.dispose();
				pmrem.dispose();
			} else {
				tex = await new TextureLoader().loadAsync(url);
				if (ac.signal.aborted) { tex.dispose(); return; }
				tex.colorSpace = SRGBColorSpace;
			}
			if (scene && !ac.signal.aborted) {
				disposeBgTexture();
				currentBgTexture = tex;
				scene.background = tex;
			} else {
				tex.dispose();
			}
		} catch {
			if (!ac.signal.aborted && scene) scene.background = new Color('#1c1c1e');
		}
	}

	// Set HSL colors when lights are ready
	$effect(() => {
		if (hemiLight) {
			hemiLight.color.setHSL(0.6, 1, 0.6); // Sky: cyan/turquoise
			hemiLight.groundColor.setHSL(0.095, 1, 0.75); // Ground: pale yellow
		}
	});

	$effect(() => {
		if (dirLight) {
			dirLight.color.setHSL(0.1, 1, 0.95); // Warm white
		}
	});

	// Re-apply background whenever the preset or dark-mode changes
	$effect(() => {
		const preset = backgroundStore.activePreset;
		const dark = isDarkMode; // reactive dependency

		if (!scene || overlay) return;

		bgImageLoadAbort?.abort();

		if (preset.type === 'image') {
			const url = backgroundStore.customUrl;
			if (url) {
				loadBackgroundImage(url);
			} else {
				disposeBgTexture();
				scene.background = new Color('#1c1c1e');
			}
		} else {
			applyBackgroundSync();
		}
	});

	interface Props {
		centered?: boolean;
		locked?: boolean;
		overlay?: boolean;
	}

	let { centered = false, locked = false, overlay = false }: Props = $props();

	const modelUrl = $derived(vrmStore.modelUrl);

	const { camera, renderer, scene, autoRender } = useThrelte();
	let controls: OrbitControls | null = null;
	let composer: EffectComposer | null = null;

	// Responsive: detect if desktop (chat sidebar visible on right)
	let isDesktop = $state(false);

	// Dark mode detection
	let isDarkMode = $state(false);

	// Create dot grid shader material - recreate on theme change for proper reactivity
	const dotGridMaterial = $derived.by(() => {
		const bgColor = isDarkMode ? SCENE_COLORS.dark.background : SCENE_COLORS.light.background;
		const dotColor = isDarkMode ? SCENE_COLORS.dark.dot : SCENE_COLORS.light.dot;

		return new ShaderMaterial({
			uniforms: {
				uBackgroundColor: { value: new Color(bgColor) },
				uDotColor: { value: new Color(dotColor) },
				uDotSize: { value: 0.025 },
				uSpacingX: { value: 200.0 },
				uSpacingY: { value: 100.0 }
			},
			vertexShader: dotGridVertexShader,
			fragmentShader: dotGridFragmentShader,
			side: BackSide,
			depthWrite: false
		});
	});

	// Set up post-processing - stored outside reactive system
	function setupComposer() {
		if (!renderer || !scene || !camera.current || composer) return;

		// Configure renderer for vibrant colors
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.toneMappingExposure = 0.8;

		// Disable Threlte's auto-render so we can use the composer
		autoRender.set(false);

		// Create new composer
		composer = new EffectComposer(renderer, {
			frameBufferType: HalfFloatType
		});

		// Add render pass
		composer.addPass(new RenderPass(scene, camera.current));

		// Add bloom effect - subtle glow on bright areas
		const bloomEffect = new BloomEffect({
			intensity: 0.15,
			luminanceThreshold: 0.85,
			luminanceSmoothing: 0.3,
			mipmapBlur: true
		});
		composer.addPass(new EffectPass(camera.current, bloomEffect));

		// Set initial size
		composer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
	}

	onMount(() => {
		// Setup composer after a small delay to ensure camera is ready
		// Skip composer in overlay mode for proper transparency
		const composerTimeout = !overlay ? setTimeout(() => {
			setupComposer();
		}, 100) : null;

		const checkDesktop = () => {
			isDesktop = window.innerWidth > 768;
		};
		checkDesktop();
		window.addEventListener('resize', checkDesktop);

	
		// Check dark mode
		const checkDarkMode = () => {
			isDarkMode = document.documentElement.classList.contains('dark');
		};
		checkDarkMode();

		// Watch for dark mode changes
		const observer = new MutationObserver(checkDarkMode);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		// Register screenshot handler
		screenshotStore.register(() => {
			if (composer) {
				composer.render();
				const dataUrl = renderer.domElement.toDataURL('image/png');
				const link = document.createElement('a');
				link.download = `utsuwa-screenshot-${Date.now()}.png`;
				link.href = dataUrl;
				link.click();
			}
		});

		// Set transparent background for overlay mode
		if (overlay) {
			if (scene) {
				scene.background = null;
			}
			// Ensure renderer clears to transparent
			if (renderer) {
				renderer.setClearColor(0x000000, 0);
			}
		}

		// Setup RoomEnvironment for PBR lighting (only non-overlay)
		if (!overlay && renderer && scene) {
			const pmrem = new PMREMGenerator(renderer);
			const roomEnv = new RoomEnvironment();
			scene.environment = pmrem.fromScene(roomEnv).texture;
			roomEnv.dispose();
			pmrem.dispose();
		}

		return () => {
			if (composerTimeout) clearTimeout(composerTimeout);
			window.removeEventListener('resize', checkDesktop);
			observer.disconnect();
			screenshotStore.unregister();
			composer?.dispose();
		};
	});

	// Background color from design language
	const backgroundColor = $derived(() => {
		return isDarkMode ? SCENE_COLORS.dark.background : SCENE_COLORS.light.background;
	});

	// Camera always centered (no sidebar offset needed with new bottom chat bar layout)
	const cameraTargetX = $derived(0);
	const cameraDistance = $derived(displayStore.cameraDistance);
	const cameraOffsetX = $derived(displayStore.cameraOffsetX);
	const cameraOffsetY = $derived(displayStore.cameraOffsetY);

	// Setup OrbitControls (skip when locked)
	$effect(() => {
		if (locked) return;

		if (camera.current && renderer) {
			controls = new OrbitControls(camera.current, renderer.domElement);
			controls.enableDamping = true;
			controls.target.set(cameraTargetX + cameraOffsetX, 1 + cameraOffsetY, 0);
			controls.minDistance = 0.5;
			controls.maxDistance = 5;
			controls.update();

			return () => {
				controls?.dispose();
			};
		}
	});

	// Update controls target and camera position when offset or desktop state changes
	$effect(() => {
		if (controls && camera.current) {
			const tx = cameraTargetX + cameraOffsetX;
			const ty = 1 + cameraOffsetY;
			controls.target.set(tx, ty, 0);
			camera.current.position.set(tx, ty + 0.15, cameraDistance);
			controls.update();
		}
	});

	// Update controls and render with post-processing each frame
	// Handle resize in render loop to prevent black flash (resize + render happen atomically)
	let lastWidth = 0;
	let lastHeight = 0;
	useTask(() => {
		controls?.update();

		// Check for resize and handle it before rendering (same frame = no flash)
		if (composer && renderer) {
			const width = renderer.domElement.clientWidth;
			const height = renderer.domElement.clientHeight;
			if (width !== lastWidth || height !== lastHeight) {
				lastWidth = width;
				lastHeight = height;
				composer.setSize(width, height);
			}
			composer.render();
		} else {
			// Fallback to normal render if composer not ready
			if (renderer && scene && camera.current) {
				renderer.render(scene, camera.current);
			}
		}
	});
</script>

<!-- Camera - view with model centered, distance/offset from display settings -->
<T.PerspectiveCamera makeDefault position={[cameraTargetX + cameraOffsetX, 1.15 + cameraOffsetY, cameraDistance]} fov={30} near={0.1} far={20} />

<!-- Overlay mode: enable raycast for click-through detection -->
{#if overlay}
	<OverlayRaycastHandler />
{/if}

<!-- Scene Background (hidden in overlay mode for transparency) -->
{#if !overlay}
	<!-- Background is controlled reactively by backgroundStore $effect above -->
	<!-- Dot Grid Background Sphere — only shown for the dot-grid preset -->
	{#if showDotGrid}
		<T.Mesh position={[0, 0, 0]}>
			<T.SphereGeometry args={[15, 64, 32]} />
			<T is={dotGridMaterial} />
		</T.Mesh>
	{/if}
{/if}

<!-- Hemisphere lighting matching Three.js example -->
<!-- https://threejs.org/examples/webgl_lights_hemisphere.html -->
<T.HemisphereLight
	bind:ref={hemiLight}
	intensity={2}
	position={[0, 50, 0]}
/>

<!-- Directional light with shadows -->
<T.DirectionalLight
	bind:ref={dirLight}
	intensity={3}
	position={[-30, 52.5, 30]}
	castShadow
	shadow.mapSize.width={2048}
	shadow.mapSize.height={2048}
	shadow.camera.left={-3}
	shadow.camera.right={3}
	shadow.camera.top={3}
	shadow.camera.bottom={-3}
	shadow.camera.far={100}
	shadow.bias={-0.0001}
/>

<!-- VRM Model -->
{#if modelUrl}
	<VrmModel url={modelUrl} />
{/if}

<!-- Ground plane - receives shadows (hidden in overlay mode) -->
{#if !overlay}
	<T.Mesh rotation.x={-Math.PI / 2} position.y={0} receiveShadow>
		<T.CircleGeometry args={[2, 64]} />
		<T.ShadowMaterial opacity={0.15} />
	</T.Mesh>
{/if}

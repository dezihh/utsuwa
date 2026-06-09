<script lang="ts">
	import { T, useThrelte, useTask } from '@threlte/core';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
	import { VRMAnimationLoaderPlugin, createVRMAnimationClip, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import { ttsStore } from '$lib/stores/tts.svelte';
	import { lipSyncAnalyzer } from '$lib/services/lipsync/analyzer';
	import { expressionController } from '$lib/services/vrm/expression-controller';
	import { untrack } from 'svelte';
	import * as THREE from 'three';

	// Pose configurations for different VRM versions
	// VRM 0.x and 1.0 have different bone orientations and coordinate systems
	const VRM_POSE_CONFIG = {
		// VRM 0.x (older models like AvatarSample_A/B)
		'0': {
			sceneRotationY: Math.PI, // Rotate 180° to face camera
			leftUpperArm: { x: Math.PI * 0.05, y: 0, z: Math.PI * 0.4 },
			rightUpperArm: { x: Math.PI * 0.05, y: 0, z: -Math.PI * 0.4 },
			leftLowerArm: { x: 0, y: -Math.PI * 0.1, z: 0 },
			rightLowerArm: { x: 0, y: Math.PI * 0.1, z: 0 }
		},
		// VRM 1.0 (VRoid Studio models like Utsuwa)
		'1': {
			sceneRotationY: 0, // Already facing camera
			leftUpperArm: { x: Math.PI * 0.05, y: 0, z: -Math.PI * 0.4 },
			rightUpperArm: { x: Math.PI * 0.05, y: 0, z: Math.PI * 0.4 },
			leftLowerArm: { x: 0, y: -Math.PI * 0.1, z: 0 }, // Same Y values as 0.x
			rightLowerArm: { x: 0, y: Math.PI * 0.1, z: 0 }
		}
	} as const;

	// Find a happy expression from available expressions (works with any model)
	function findHappyExpression(vrmInstance: VRM): string | null {
		const expressions = vrmInstance.expressionManager?.expressions;
		if (!expressions) return null;

		// Priority order of happy-like expressions to look for
		const happyKeywords = ['happy', 'joy', 'smile', 'fun', 'cheerful'];

		for (const keyword of happyKeywords) {
			const match = expressions.find((e) => e.expressionName.toLowerCase().includes(keyword));
			if (match) return match.expressionName;
		}
		return null;
	}

	interface Props {
		url: string;
	}

	let { url }: Props = $props();
	let vrm = $state<VRM | null>(null);
	let group = $state<THREE.Group | null>(null);

	// === Animation State ===
	let mixer = $state<THREE.AnimationMixer | null>(null);
	let idleAction = $state<THREE.AnimationAction | null>(null); // Current idle animation
	let talkingAction = $state<THREE.AnimationAction | null>(null); // Looping talking animation
	let talkingClip = $state<THREE.AnimationClip | null>(null); // Cached talking clip
	let emoteAction = $state<THREE.AnimationAction | null>(null); // One-shot emote animations
	let isEmotePlaying = $state(false); // True when an emote is playing (disables blinking)
	let lastIdleIndex = $state(-1); // Track last played idle to avoid repeats
	let activeLipSyncAnalyser: AnalyserNode | null = null;
	let emoteFinishedListener: ((e: { action: THREE.AnimationAction }) => void) | null = null;
	const currentAnimation = $derived(vrmStore.currentAnimation);
	// Talking animation plays when TTS is speaking OR when text-based talking is triggered
	const shouldTalk = $derived(ttsStore.isSpeaking || vrmStore.isTalking);

	// === Blinking State ===
	let blinkTimer = $state(0);
	let nextBlinkTime = $state(Math.random() * 4 + 2); // 2-6 seconds
	let isBlinking = $state(false);
	let blinkProgress = $state(0);

	// === Breathing State ===
	let breathTime = $state(0);
	const BREATH_SPEED = 0.8; // cycles per second
	const BREATH_INTENSITY = 0.015; // subtle movement

	// === Eye Saccade State ===
	let saccadeTime = $state(0);
	let nextSaccadeIn = $state(1 + Math.random() * 2);
	let eyeTarget = $state({ x: 0, y: 0 });
	let currentEyeTarget = $state({ x: 0, y: 0 });

	// === Idle Face Animation State ===
	let idleFaceTime = $state(0);
	let headTime = $state(0);

	const { renderer, camera } = useThrelte();

	// Generate thumbnail from the current 3D render
	function generateThumbnail() {
		if (!renderer) return;

		const canvas = renderer.domElement;
		if (!canvas) return;

		const size = 256;
		const thumbCanvas = document.createElement('canvas');
		thumbCanvas.width = size;
		thumbCanvas.height = size;
		const ctx = thumbCanvas.getContext('2d');

		if (ctx) {
			const srcSize = Math.min(canvas.width, canvas.height);
			const srcX = (canvas.width - srcSize) / 2;
			const srcY = (canvas.height - srcSize) / 2;

			ctx.drawImage(canvas, srcX, srcY, srcSize, srcSize, 0, 0, size, size);

			const thumbnailDataUrl = thumbCanvas.toDataURL('image/png');
			vrmStore.setModelPreview(vrmStore.activeModelId, thumbnailDataUrl);
		}
	}

	// Normalize model orientation and position
	function normalizeModel(loadedVrm: VRM) {
		const scene = loadedVrm.scene;
		const version = loadedVrm.meta?.metaVersion === '1' ? '1' : '0';
		const config = VRM_POSE_CONFIG[version];

		// Apply version-specific scene rotation
		scene.rotation.y = config.sceneRotationY;

		// Calculate bounding box
		const box = new THREE.Box3().setFromObject(scene);
		const center = box.getCenter(new THREE.Vector3());

		// Center model at origin (X and Z)
		scene.position.x = -center.x;
		scene.position.z = -center.z;

		// Ground the model (feet at y=0)
		scene.position.y = -box.min.y;
	}

	// Set a natural idle pose (arms relaxed at sides)
	function setIdlePose(loadedVrm: VRM) {
		const humanoid = loadedVrm.humanoid;
		const version = loadedVrm.meta?.metaVersion === '1' ? '1' : '0';
		const config = VRM_POSE_CONFIG[version];

		// Get arm bones
		const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
		const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
		const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
		const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');

		// Apply version-specific arm rotations
		if (leftUpperArm) {
			leftUpperArm.rotation.set(config.leftUpperArm.x, config.leftUpperArm.y, config.leftUpperArm.z);
		}
		if (rightUpperArm) {
			rightUpperArm.rotation.set(config.rightUpperArm.x, config.rightUpperArm.y, config.rightUpperArm.z);
		}
		if (leftLowerArm) {
			leftLowerArm.rotation.set(config.leftLowerArm.x, config.leftLowerArm.y, config.leftLowerArm.z);
		}
		if (rightLowerArm) {
			rightLowerArm.rotation.set(config.rightLowerArm.x, config.rightLowerArm.y, config.rightLowerArm.z);
		}
	}

	// Pick a random idle animation index, excluding the last played one
	function pickRandomIdleIndex(): number {
		const urls = vrmStore.idleAnimationUrls;
		if (urls.length <= 1) return 0;

		let newIndex: number;
		do {
			newIndex = Math.floor(Math.random() * urls.length);
		} while (newIndex === lastIdleIndex);

		return newIndex;
	}

	// Idle animation cycling timer
	let idleCycleTimeout: ReturnType<typeof setTimeout> | null = null;

	/** Dispose an animation action to prevent mixer bloat.
	 *  Uses a microtask to avoid race conditions during mixer.update(). */
	function disposeAction(action: THREE.AnimationAction | null) {
		if (!action) return;
		const m = action.getMixer();
		const clip = action.getClip();
		action.stop();
		// Defer uncache to next tick so mixer.update() in the current frame
		// never touches a partially-removed action/clip.
		queueMicrotask(() => {
			m.uncacheAction(clip);
		});
	}

	// Load and start the looping idle animation
	function startIdleAnimation(targetVrm: VRM, targetMixer: THREE.AnimationMixer) {
		const urls = vrmStore.idleAnimationUrls;
		if (!urls || urls.length === 0) return;

		const index = pickRandomIdleIndex();
		lastIdleIndex = index;
		const idleUrl = urls[index];

		const loader = new GLTFLoader();
		loader.register((parser) => ({
			name: 'VRMA-Preprocessor',
			beforeRoot: async () => {
				// Some VRMA files contain 'weights' channels (morph targets) that the
				// VRMAnimationLoaderPlugin doesn't support. Filter them out.
				const json = parser.json;
				if (!json.animations) return;
				for (const anim of json.animations) {
					if (!anim.channels) continue;
					const filteredChannels = [];
					const oldToNewSampler = new Map();
					let newSamplerIdx = 0;
					for (const ch of anim.channels) {
						if (ch.target?.path === 'weights') {
							console.warn('[VrmModel] Filtering unsupported "weights" channel from animation');
							continue;
						}
						if (!oldToNewSampler.has(ch.sampler)) {
							oldToNewSampler.set(ch.sampler, newSamplerIdx++);
						}
						ch.sampler = oldToNewSampler.get(ch.sampler);
						filteredChannels.push(ch);
					}
					anim.channels = filteredChannels;
					if (anim.samplers) {
						const newSamplers = [];
						for (let i = 0; i < anim.samplers.length; i++) {
							if (oldToNewSampler.has(i)) {
								newSamplers[oldToNewSampler.get(i)] = anim.samplers[i];
							}
						}
						anim.samplers = newSamplers;
					}
				}
			},
			afterRoot: async (gltf) => {
				if (!gltf.scene) {
					gltf.scene = new THREE.Group();
					gltf.scenes = [gltf.scene];
				}
			}
		}));
		loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

		loader.load(
			idleUrl,
			(gltf) => {
				const vrmAnimations = gltf.userData.vrmAnimations;
				if (!vrmAnimations || vrmAnimations.length === 0) {
					console.error('No idle animation found');
					return;
				}

				const clip = createVRMAnimationClip(vrmAnimations[0], targetVrm);
				const action = targetMixer.clipAction(clip);
				action.setLoop(THREE.LoopRepeat, Infinity);
				action.play();
				idleAction = action;

				// Schedule next animation change
				scheduleIdleCycle(targetVrm, targetMixer, clip.duration);
			},
			undefined,
			(error) => {
				console.error('Error loading idle animation:', error);
			}
		);
	}

	// Schedule the next idle animation switch
	function scheduleIdleCycle(targetVrm: VRM, targetMixer: THREE.AnimationMixer, duration: number) {
		if (idleCycleTimeout) {
			clearTimeout(idleCycleTimeout);
		}
		// Switch after 1-2 full loops of the current animation
		const loops = 1 + Math.random();
		const delay = duration * loops * 1000;
		idleCycleTimeout = setTimeout(() => {
			if (!shouldTalk && !isEmotePlaying) {
				playNextIdleAnimation(targetVrm, targetMixer);
			} else {
				// Retry later if we're busy
				scheduleIdleCycle(targetVrm, targetMixer, duration);
			}
		}, delay);
	}

	// Play the next random idle animation with smooth crossfade
	function playNextIdleAnimation(targetVrm: VRM, targetMixer: THREE.AnimationMixer) {
		const urls = vrmStore.idleAnimationUrls;
		if (!urls || urls.length === 0) return;

		const index = pickRandomIdleIndex();
		lastIdleIndex = index;
		const idleUrl = urls[index];

		const loader = new GLTFLoader();
		loader.register((parser) => ({
			name: 'VRMA-Preprocessor',
			beforeRoot: async () => {
				// Some VRMA files contain 'weights' channels (morph targets) that the
				// VRMAnimationLoaderPlugin doesn't support. Filter them out.
				const json = parser.json;
				if (!json.animations) return;
				for (const anim of json.animations) {
					if (!anim.channels) continue;
					const filteredChannels = [];
					const oldToNewSampler = new Map();
					let newSamplerIdx = 0;
					for (const ch of anim.channels) {
						if (ch.target?.path === 'weights') {
							console.warn('[VrmModel] Filtering unsupported "weights" channel from animation');
							continue;
						}
						if (!oldToNewSampler.has(ch.sampler)) {
							oldToNewSampler.set(ch.sampler, newSamplerIdx++);
						}
						ch.sampler = oldToNewSampler.get(ch.sampler);
						filteredChannels.push(ch);
					}
					anim.channels = filteredChannels;
					if (anim.samplers) {
						const newSamplers = [];
						for (let i = 0; i < anim.samplers.length; i++) {
							if (oldToNewSampler.has(i)) {
								newSamplers[oldToNewSampler.get(i)] = anim.samplers[i];
							}
						}
						anim.samplers = newSamplers;
					}
				}
			},
			afterRoot: async (gltf) => {
				if (!gltf.scene) {
					gltf.scene = new THREE.Group();
					gltf.scenes = [gltf.scene];
				}
			}
		}));
		loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

		loader.load(
			idleUrl,
			(gltf) => {
				const vrmAnimations = gltf.userData.vrmAnimations;
				if (!vrmAnimations || vrmAnimations.length === 0) return;

				// Fade out and dispose current idle after crossfade
				const oldIdle = idleAction;
				if (oldIdle) {
					oldIdle.fadeOut(1.2);
					setTimeout(() => disposeAction(oldIdle), 1500);
				}

				const clip = createVRMAnimationClip(vrmAnimations[0], targetVrm);
				const action = targetMixer.clipAction(clip);
				action.setLoop(THREE.LoopRepeat, Infinity);
				action.reset().fadeIn(1.2).play();
				idleAction = action;

				// Schedule next change
				scheduleIdleCycle(targetVrm, targetMixer, clip.duration);
			},
			undefined,
			(error) => {
				console.error('Error loading idle animation:', error);
			}
		);
	}

	// Load the talking animation clip (called once after model loads)
	function loadTalkingAnimation(targetVrm: VRM, targetMixer: THREE.AnimationMixer) {
		const talkingUrl = vrmStore.talkingAnimationUrl;
		if (!talkingUrl) return;

		const loader = new GLTFLoader();
		loader.register((parser) => ({
			name: 'VRMA-Preprocessor',
			beforeRoot: async () => {
				// Some VRMA files contain 'weights' channels (morph targets) that the
				// VRMAnimationLoaderPlugin doesn't support. Filter them out.
				const json = parser.json;
				if (!json.animations) return;
				for (const anim of json.animations) {
					if (!anim.channels) continue;
					const filteredChannels = [];
					const oldToNewSampler = new Map();
					let newSamplerIdx = 0;
					for (const ch of anim.channels) {
						if (ch.target?.path === 'weights') {
							console.warn('[VrmModel] Filtering unsupported "weights" channel from animation');
							continue;
						}
						if (!oldToNewSampler.has(ch.sampler)) {
							oldToNewSampler.set(ch.sampler, newSamplerIdx++);
						}
						ch.sampler = oldToNewSampler.get(ch.sampler);
						filteredChannels.push(ch);
					}
					anim.channels = filteredChannels;
					if (anim.samplers) {
						const newSamplers = [];
						for (let i = 0; i < anim.samplers.length; i++) {
							if (oldToNewSampler.has(i)) {
								newSamplers[oldToNewSampler.get(i)] = anim.samplers[i];
							}
						}
						anim.samplers = newSamplers;
					}
				}
			},
			afterRoot: async (gltf) => {
				if (!gltf.scene) {
					gltf.scene = new THREE.Group();
					gltf.scenes = [gltf.scene];
				}
			}
		}));
		loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

		loader.load(
			talkingUrl,
			(gltf) => {
				const vrmAnimations = gltf.userData.vrmAnimations;
				if (!vrmAnimations || vrmAnimations.length === 0) {
					console.error('No talking animation found');
					return;
				}

				const clip = createVRMAnimationClip(vrmAnimations[0], targetVrm);
				talkingClip = clip;
			},
			undefined,
			(error) => {
				console.error('Error loading talking animation:', error);
			}
		);
	}

	// Lip-sync analyser is updated in the frame loop below — no $effect needed.
	// (A reactive $effect has a tracking gap after the first segment; the frame loop handles all.)

	// Sync store emotion to expression controller.
	$effect(() => {
		expressionController.setMappings(vrmStore.emotionProfile);
		expressionController.setEmotion(vrmStore.currentEmotion);
	});

	// Watch for action triggers from [action:xxx] tags.
	$effect(() => {
		const action = vrmStore.pendingAction;
		if (!action) return;

		const actionAnimations: Record<string, string> = {
			wave: '/animations/Goodbye.vrma',
			nod: '/animations/nod.vrma',
			shake: '/animations/shake.vrma',
			jump: '/animations/Jump.vrma',
			bow: '/animations/bow.vrma',
			think: '/animations/Thinking.vrma',
			clap: '/animations/Clapping.vrma',
			dance: '/animations/dance.vrma'
		};

		(async () => {
			const animUrl = actionAnimations[action];
			if (animUrl) {
				try {
					const probe = await fetch(animUrl, { method: 'HEAD' });
					if (probe.ok) {
						vrmStore.setCurrentAnimation(animUrl);
					}
				} catch {
					// Missing action animation is non-fatal.
				}
			}
			vrmStore.clearPendingAction();
		})();
	});

	// Body talking animation is intentionally disabled.
	// Mouth movement is handled by audio-driven lip-sync.

	// Play emote animations when currentAnimation changes
	$effect(() => {
		const animId = currentAnimation;
		const currentVrm = untrack(() => vrm);
		const currentMixer = untrack(() => mixer);
		const currentIdleAction = untrack(() => idleAction);

		if (!currentVrm || !currentMixer) return;

		// Stop and clean up any current emote before starting a new one
		const prevEmote = untrack(() => emoteAction);
		if (prevEmote) {
			disposeAction(prevEmote);
			emoteAction = null;
			isEmotePlaying = false;
		}
		// Remove stale finished listener so it doesn't fire after the emote is gone
		if (emoteFinishedListener && currentMixer) {
			currentMixer.removeEventListener('finished', emoteFinishedListener);
			emoteFinishedListener = null;
		}

		// If no emote selected, just ensure idle is playing
		if (!animId) {
			isEmotePlaying = false;
			emoteAction = null;
			if (currentIdleAction && !currentIdleAction.isRunning()) {
				currentIdleAction.reset().fadeIn(0.3).play();
			}
			return;
		}

		// Accept either registered animation IDs or direct /animations/*.vrma paths.
		const animationData = vrmStore.availableAnimations.find((a) => a.url === animId || a.id === animId);
		const animationUrl = typeof animId === 'string' && animId.startsWith('/') ? animId : animationData?.url;
		if (!animationUrl) return;

		// Load emote VRMA file
		const loader = new GLTFLoader();

		// Some VRMA files don't have a scene, but the plugin expects one.
		// Register a dummy plugin first to ensure gltf.scene exists.
		loader.register((parser) => ({
			name: 'VRMA-Preprocessor',
			beforeRoot: async () => {
				const json = parser.json;
				if (!json.animations) return;
				for (const anim of json.animations) {
					if (!anim.channels) continue;
					const filteredChannels = [];
					const oldToNewSampler = new Map();
					let newSamplerIdx = 0;
					for (const ch of anim.channels) {
						if (ch.target?.path === 'weights') {
							console.warn('[VrmModel] Filtering unsupported "weights" channel from animation');
							continue;
						}
						if (!oldToNewSampler.has(ch.sampler)) {
							oldToNewSampler.set(ch.sampler, newSamplerIdx++);
						}
						ch.sampler = oldToNewSampler.get(ch.sampler);
						filteredChannels.push(ch);
					}
					anim.channels = filteredChannels;
					if (anim.samplers) {
						const newSamplers = [];
						for (let i = 0; i < anim.samplers.length; i++) {
							if (oldToNewSampler.has(i)) {
								newSamplers[oldToNewSampler.get(i)] = anim.samplers[i];
							}
						}
						anim.samplers = newSamplers;
					}
				}
			},
			afterRoot: async (gltf) => {
				if (!gltf.scene) {
					console.warn('[VrmModel] VRMA has no scene, injecting dummy scene for', animationUrl);
					gltf.scene = new THREE.Group();
					gltf.scenes = [gltf.scene];
				}
			}
		}));

		loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

		loader.load(
			animationUrl,
			(gltf) => {
				const vrmAnimations = gltf.userData.vrmAnimations;
				if (!vrmAnimations || vrmAnimations.length === 0) {
					console.error('No VRM animations found in file');
					return;
				}

				untrack(() => {
					if (!vrm || !mixer) return;

					// Fade out idle animation
					const currentIdle = idleAction;
					if (currentIdle) {
						currentIdle.fadeOut(0.2);
					}

					// Create and play emote
					let action: THREE.AnimationAction | undefined;
					try {
						const clip = createVRMAnimationClip(vrmAnimations[0], vrm);
						action = mixer.clipAction(clip);
						action.setLoop(THREE.LoopOnce, 1);
						action.clampWhenFinished = true;
						action.timeScale = 1.5;
						action.reset().fadeIn(0.2).play();
						emoteAction = action;
						isEmotePlaying = true;
						console.log('[VrmModel] Emote playing:', animationUrl);
					} catch (err) {
						console.error('[VrmModel] Failed to create animation clip:', animationUrl, err);
						// Fade idle back in
						if (currentIdle) {
							currentIdle.reset().fadeIn(0.3).play();
						}
						return;
					}

					// Apply happy expression during emote
					const happyExpr = findHappyExpression(vrm);
					if (happyExpr) {
						vrm.expressionManager?.setValue(happyExpr, 0.7);
					}

						// When emote finishes, return to idle and dispose the emote
						const capturedMixer = mixer;
						const capturedVrm = vrm;
						const capturedIdleAction = currentIdle;
						const onFinished = (e: { action: THREE.AnimationAction }) => {
							if (e.action === action) {
								capturedMixer.removeEventListener('finished', onFinished);
								emoteFinishedListener = null;
								isEmotePlaying = false;
								emoteAction = null;

								// Dispose the finished emote action and its clip
								disposeAction(e.action);

								// Clear happy expression
								if (happyExpr) {
									capturedVrm.expressionManager?.setValue(happyExpr, 0);
								}

								// Resume idle animation
								if (capturedIdleAction) {
									capturedIdleAction.reset().fadeIn(0.3).play();
								}

								vrmStore.setCurrentAnimation(null);
							}
						};
						emoteFinishedListener = onFinished;
						capturedMixer.addEventListener('finished', onFinished);

				});
			},
			(xhr) => {
				if (xhr.lengthComputable) {
					console.log('[VrmModel] Loading progress:', animationUrl, Math.round((xhr.loaded / xhr.total) * 100) + '%');
				}
			},
			(error) => {
				console.error('[VrmModel] Error loading emote animation:', animationUrl, error);
				if (error instanceof Error && error.stack) {
					console.error('[VrmModel] Stack trace:', error.stack);
				}
			}
		);
	});

	// Load VRM when URL changes
	$effect(() => {
		if (!url) return;

		vrmStore.setLoading(true);
		vrmStore.setError(null);

		const loader = new GLTFLoader();
		loader.crossOrigin = 'anonymous';
		loader.register((parser) => {
			const plugin = new VRMLoaderPlugin(parser);
			// Enable thumbnail loading for VRM 1.0 models
			if (plugin.metaPlugin) {
				plugin.metaPlugin.needThumbnailImage = true;
			}
			return plugin;
		});

		loader.load(
			url,
			(gltf) => {
				const loadedVrm = gltf.userData.vrm as VRM;

				// Optimize VRM
				VRMUtils.removeUnnecessaryVertices(loadedVrm.scene);
				VRMUtils.combineSkeletons(loadedVrm.scene);

				// Configure rendering settings for all meshes
				loadedVrm.scene.traverse((obj) => {
					obj.frustumCulled = false;
					// Enable shadow casting for AO and god rays effects
					if (obj instanceof THREE.Mesh) {
						obj.castShadow = true;
						obj.receiveShadow = true;
					}
				});

				// Normalize model orientation and position
				normalizeModel(loadedVrm);

				// Set a natural idle pose (arms down instead of T-pose)
				setIdlePose(loadedVrm);

				vrm = loadedVrm;
				group = loadedVrm.scene;
				const newMixer = new THREE.AnimationMixer(loadedVrm.scene);
				mixer = newMixer;
				vrmStore.setVrm(loadedVrm);
				vrmStore.setLoading(false);

				// Add LookAt proxy so createVRMAnimationClip doesn't warn about missing one
				if (loadedVrm.lookAt) {
					const lookAtProxy = new VRMLookAtQuaternionProxy(loadedVrm.lookAt);
					lookAtProxy.name = 'VRMLookAtQuaternionProxy';
					loadedVrm.scene.add(lookAtProxy);
				}

				// Start the looping idle animation
				startIdleAnimation(loadedVrm, newMixer);

				// Pre-load the talking animation
				loadTalkingAnimation(loadedVrm, newMixer);

				// Debug: Log available expressions
				// if (loadedVrm.expressionManager) {
				// 	const expressions = loadedVrm.expressionManager.expressions;
				// 	console.log(
				// 		'Available expressions:',
				// 		expressions.map((e) => e.expressionName)
				// 	);
				// }

				// Extract thumbnail from VRM metadata (supports both 0.x and 1.0)
				let thumbnailImage: HTMLImageElement | undefined;

				if (loadedVrm.meta) {
					if (loadedVrm.meta.metaVersion === '1') {
						// VRM 1.0: thumbnailImage is HTMLImageElement
						thumbnailImage = (loadedVrm.meta as any).thumbnailImage;
					} else {
						// VRM 0.x: texture contains the image
						const texture = (loadedVrm.meta as any).texture;
						if (texture?.image) {
							thumbnailImage = texture.image;
						}
					}
				}

				if (thumbnailImage) {
					try {
						const canvas = document.createElement('canvas');
						const width = thumbnailImage.width || (thumbnailImage as any).naturalWidth || 256;
						const height = thumbnailImage.height || (thumbnailImage as any).naturalHeight || 256;
						canvas.width = width;
						canvas.height = height;
						const ctx = canvas.getContext('2d');
						if (ctx) {
							ctx.drawImage(thumbnailImage as CanvasImageSource, 0, 0);
							const thumbnailDataUrl = canvas.toDataURL('image/png');
							vrmStore.setModelPreview(vrmStore.activeModelId, thumbnailDataUrl);
						}
					} catch (e) {
						console.error('Failed to extract thumbnail:', e);
						setTimeout(() => generateThumbnail(), 500);
					}
				} else {
					// No embedded thumbnail - generate one from the 3D render
					setTimeout(() => generateThumbnail(), 500);
				}

			},
			() => {},
			(error) => {
				console.error('Error loading VRM:', error);
				vrmStore.setError('Failed to load VRM model');
			}
		);

		return () => {
			// Cleanup on unmount or URL change
			if (mixer) {
				mixer.stopAllAction();
				mixer = null;
				idleAction = null;
				talkingAction = null;
				talkingClip = null;
				emoteAction = null;
			}
			if (vrm) {
				vrm.scene.traverse((obj: THREE.Object3D) => {
					if (obj instanceof THREE.Mesh) {
						obj.geometry?.dispose();
						if (Array.isArray(obj.material)) {
							obj.material.forEach((m) => m.dispose());
						} else if (obj.material) {
							obj.material.dispose();
						}
					}
				});
				vrmStore.setVrm(null);
				vrm = null;
				group = null;
			}
		};
	});

	// Update VRM each frame
	useTask((delta) => {
		if (!vrm) return;

		// Keep the lip-sync analyser aligned with the active TTS source.
		const analyser = ttsStore.currentAnalyser;
		if (analyser !== activeLipSyncAnalyser) {
			console.log('[VrmModel] analyser changed:', activeLipSyncAnalyser, '→', analyser);
			activeLipSyncAnalyser = analyser;
			lipSyncAnalyzer.setAnalyser(analyser);
		}

		const overrides = vrmStore.developerExpressionOverrides;

		// LookAt directions driven by Developer overrides.
		// These map slider values (0-1) directly to lookAt yaw/pitch angles.
		const LOOKAT_DIRECTIONS = new Set(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);
		const hasLookAtDirOverride = [...overrides.keys()].some((n) => LOOKAT_DIRECTIONS.has(n));

		// eye/lookAt expressions that the LookAt applier overwrites every frame
		const LOOKAT_EXPRESSIONS = new Set([
			'eyeLookUpLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft',
			'eyeLookUpRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight',
			'eyeBlinkLeft', 'eyeBlinkRight',
			...LOOKAT_DIRECTIONS
		]);
		const hasLookAtExprOverride = [...overrides.keys()].some((n) => LOOKAT_EXPRESSIONS.has(n));

		// Pause LookAt auto-update while eye/lookAt expressions are overridden
		if (hasLookAtExprOverride && vrm.lookAt) {
			vrm.lookAt.autoUpdate = false;
		} else if (vrm.lookAt && !hasLookAtExprOverride && !vrm.lookAt.autoUpdate) {
			vrm.lookAt.autoUpdate = true;
		}

		// Calculate lookAt direction from Developer overrides.
		// These map slider values (0-1) directly to lookAt yaw/pitch angles.
		let lookAtPitch = 0;
		let lookAtYaw = 0;
		if (hasLookAtDirOverride && vrm.lookAt) {
			const up = overrides.get('lookUp') || 0;
			const down = overrides.get('lookDown') || 0;
			const left = overrides.get('lookLeft') || 0;
			const right = overrides.get('lookRight') || 0;
			if (up) lookAtPitch -= 30 * up;
			if (down) lookAtPitch += 30 * down;
			if (left) lookAtYaw += 30 * left;
			if (right) lookAtYaw -= 30 * right;
			vrm.lookAt.pitch = lookAtPitch;
			vrm.lookAt.yaw = lookAtYaw;
		} else if (hasLookAtExprOverride && vrm.lookAt) {
			// No direction override, but LookAt is paused — reset to neutral.
			vrm.lookAt.reset();
		}

		// Update animation mixer (idle animation rotates bones)
		mixer?.update(delta);

		// Re-apply expression overrides after mixer update
		if (overrides.size > 0 && vrm.expressionManager) {
			for (const [name, value] of overrides) {
				// Skip lookAt directions — those are handled below via direct bone rotation
				if (LOOKAT_DIRECTIONS.has(name)) continue;
				try {
					vrm.expressionManager.setValue(name, value);
				} catch {
					// Expression doesn't exist on this model
				}
			}
			vrm.expressionManager.update();
		}

		// Update VRM core
		vrm.update(delta);

		// Apply Developer lookAt direction overrides.
		// We pause the idle animation so it doesn't overwrite our bone rotations,
		// then rotate head and eyes directly. This only affects the Developer page.
		if (hasLookAtDirOverride) {
			if (idleAction && !idleAction.paused) idleAction.paused = true;

			const head = vrm.humanoid.getNormalizedBoneNode('head');
			const leftEye = vrm.humanoid.getNormalizedBoneNode('leftEye');
			const rightEye = vrm.humanoid.getNormalizedBoneNode('rightEye');
			const pitchRad = THREE.MathUtils.degToRad(lookAtPitch);
			const yawRad = THREE.MathUtils.degToRad(lookAtYaw);

			if (head) {
				head.rotation.x = pitchRad;
				head.rotation.y = yawRad;
				head.updateMatrixWorld();
			}
			if (leftEye) {
				leftEye.rotation.x = pitchRad * 0.5;
				leftEye.rotation.y = yawRad * 0.5;
				leftEye.updateMatrixWorld();
			}
			if (rightEye) {
				rightEye.rotation.x = pitchRad * 0.5;
				rightEye.rotation.y = yawRad * 0.5;
				rightEye.updateMatrixWorld();
			}
		} else {
			// LookAt inactive — resume idle animation
			if (idleAction && idleAction.paused) idleAction.paused = false;

			// Reset head/eye rotations to neutral if they were previously overridden
			const head = vrm.humanoid.getNormalizedBoneNode('head');
			const leftEye = vrm.humanoid.getNormalizedBoneNode('leftEye');
			const rightEye = vrm.humanoid.getNormalizedBoneNode('rightEye');
			if (head) {
				head.rotation.x = 0;
				head.rotation.y = 0;
				head.updateMatrixWorld();
			}
			if (leftEye) {
				leftEye.rotation.x = 0;
				leftEye.rotation.y = 0;
				leftEye.updateMatrixWorld();
			}
			if (rightEye) {
				rightEye.rotation.x = 0;
				rightEye.rotation.y = 0;
				rightEye.updateMatrixWorld();
			}
		}

		// Track head position for 3D speech bubble
		const headBone = vrm.humanoid.getNormalizedBoneNode('head');
		if (headBone && camera.current) {
			const worldPos = headBone.getWorldPosition(new THREE.Vector3());
			// Offset above and slightly in front of head (used for text bubble)
			const offsetPos = new THREE.Vector3(worldPos.x, worldPos.y + 0.25, worldPos.z + 0.1);
			vrmStore.setHeadPosition([offsetPos.x, offsetPos.y, offsetPos.z]);

			// Project to screen coordinates
			const screenPos = offsetPos.clone().project(camera.current);
			// Convert from NDC (-1 to 1) to screen percentage (0 to 100)
			const x = (screenPos.x + 1) * 50;
			const y = (-screenPos.y + 1) * 50;
			vrmStore.setHeadScreenPosition({ x, y });

			// Separate anchor well above the head top — for typing indicator only
			const abovePos = new THREE.Vector3(worldPos.x, worldPos.y + 0.5, worldPos.z + 0.1);
			const aboveScreen = abovePos.clone().project(camera.current);
			vrmStore.setHeadTopScreenPosition({
				x: (aboveScreen.x + 1) * 50,
				y: (-aboveScreen.y + 1) * 50
			});
		}

		const expressionManager = vrm.expressionManager;
		if (!expressionManager) return;

		// Helper to set expression (silently ignores if not found)
		const setExpression = (name: string, value: number) => {
			try {
				expressionManager.setValue(name, value);
			} catch {
				// Expression doesn't exist on this model
			}
		};

		// Expressions manually set on the Developer page are protected from
		// automatic systems (blink, lip-sync, emotion controller).
		// overrides was already fetched earlier in this frame to re-apply after vrm.update().
		const isOverridden = (name: string) => overrides.has(name);

		// === Blinking Animation (runs during idle, disabled during emotes) ===
		if (!isEmotePlaying) {
			blinkTimer += delta;

			if (!isBlinking && blinkTimer >= nextBlinkTime) {
				// Start blink
				isBlinking = true;
				blinkProgress = 0;
			}

			if (isBlinking) {
				blinkProgress += delta * 8; // Blink duration ~0.125s

				// Asymmetric blink curve: quick close (30%), slow open (70%)
				let blinkValue: number;
				if (blinkProgress < 0.3) {
					// Quick close
					blinkValue = blinkProgress / 0.3;
				} else {
					// Slow open
					blinkValue = 1 - (blinkProgress - 0.3) / 0.7;
				}

				const finalBlinkValue = Math.max(0, blinkValue);

				if (blinkProgress >= 1) {
					// End blink
					isBlinking = false;
					blinkTimer = 0;
					nextBlinkTime = Math.random() * 4 + 2; // Random 2-6 seconds
					// Try all blink expression variants — respect overrides
					if (!isOverridden('blink')) setExpression('blink', 0);
					if (!isOverridden('Blink')) setExpression('Blink', 0);
					if (!isOverridden('eyeBlinkLeft')) setExpression('eyeBlinkLeft', 0);
					if (!isOverridden('eyeBlinkRight')) setExpression('eyeBlinkRight', 0);
				} else {
					// Try all blink expression variants — respect overrides
					if (!isOverridden('blink')) setExpression('blink', finalBlinkValue);
					if (!isOverridden('Blink')) setExpression('Blink', finalBlinkValue);
					if (!isOverridden('eyeBlinkLeft')) setExpression('eyeBlinkLeft', finalBlinkValue);
					if (!isOverridden('eyeBlinkRight')) setExpression('eyeBlinkRight', finalBlinkValue);
				}
			}
		}

		// === Lip-sync Animation ===
		const visemes = lipSyncAnalyzer.update(delta);

		// Apply viseme weights - try multiple naming conventions
		// VRM 1.0 style
		if (!isOverridden('aa')) setExpression('aa', visemes.aa);
		if (!isOverridden('ee')) setExpression('ee', visemes.ee);
		if (!isOverridden('ih')) setExpression('ih', visemes.ih);
		if (!isOverridden('oh')) setExpression('oh', visemes.oh);
		if (!isOverridden('ou')) setExpression('ou', visemes.ou);
		// VRM 0.x style
		if (!isOverridden('a')) setExpression('a', visemes.aa);
		if (!isOverridden('i')) setExpression('i', visemes.ih);
		if (!isOverridden('u')) setExpression('u', visemes.ou);
		if (!isOverridden('e')) setExpression('e', visemes.ee);
		if (!isOverridden('o')) setExpression('o', visemes.oh);
		// ARKit style (jawOpen for mouth)
		if (!isOverridden('jawOpen')) setExpression('jawOpen', visemes.aa * 0.7);

		// === Emotion expression animation ===
		const emotionWeights = expressionController.update(delta);
		for (const [exprName, weight] of emotionWeights) {
			if (isOverridden(exprName)) continue;
			if (weight > 0.01) setExpression(exprName, weight);
			else setExpression(exprName, 0);
		}

		// Apply all expression changes (blink, lip-sync, emotion)
		expressionManager.update();
	});
</script>

{#if group}
	<T is={group} />
{/if}

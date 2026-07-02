<script lang="ts">
	import { browser } from '$app/environment';
	import { unlockAudioContext } from '$lib/services/tts';
	import UpdateBanner from '$lib/components/updater/UpdateBanner.svelte';

	let { children } = $props();

	// iOS Safari: unlock AudioContext on first user interaction so async TTS
	// playback works even when the user starts with chat instead of VOX.
	if (browser) {
		let unlocked = false;
		const once = () => {
			if (unlocked) return;
			unlocked = true;
			unlockAudioContext();
			window.removeEventListener('touchstart', once, { capture: true });
			window.removeEventListener('click', once, { capture: true });
		};
		window.addEventListener('touchstart', once, { capture: true, passive: true });
		window.addEventListener('click', once, { capture: true });
	}
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="app">
	{@render children()}
	<UpdateBanner />
</div>

<style>
	.app {
		height: 100vh;
		width: 100vw;
		overflow: hidden;
	}
</style>

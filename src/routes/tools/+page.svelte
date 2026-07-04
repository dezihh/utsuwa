<script lang="ts">
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>Tools — Utsuwa</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="tools-page">
	<div class="tools-card">
		<h1>Utsuwa Tools</h1>
		<p class="subtitle">
			Internal utilities for testing prompts and voice output. These pages are not linked from the
			public site.
		</p>

		<ul class="tool-list">
			<li>
				<a href="{base}/tools/workbench">
					<span class="tool-title">Prompt Workbench</span>
					<span class="tool-desc">Iterate on system prompts and preview LLM responses.</span>
				</a>
			</li>
			<li>
				<a href="{base}/tools/speech-workbench">
					<span class="tool-title">Speech Workbench</span>
					<span class="tool-desc">Test TTS providers, voices, and speech settings.</span>
				</a>
			</li>
		</ul>
	</div>
</main>

<style>
	.tools-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: var(--bg-page);
		color: var(--text-primary);
	}

	.tools-card {
		width: 100%;
		max-width: 32rem;
		padding: 2rem;
		border-radius: var(--radius-xl, 1rem);
		background: var(--bg-card, var(--bg-page));
		border: 1px solid var(--border-subtle);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.75rem;
		font-weight: 600;
	}

	.subtitle {
		margin: 0 0 1.5rem;
		color: var(--text-secondary);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.tool-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tool-list a {
		display: block;
		padding: 1rem;
		border-radius: var(--radius-lg, 0.75rem);
		border: 1px solid var(--border-subtle);
		background: var(--bg-subtle, transparent);
		color: inherit;
		text-decoration: none;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.tool-list a:hover {
		background: var(--bg-hover, rgba(0, 0, 0, 0.03));
		border-color: var(--border-hover);
	}

	.tool-title {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.tool-desc {
		display: block;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
</style>

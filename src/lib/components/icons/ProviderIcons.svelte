<script lang="ts" module>
	// Provider icons - using simple-icons (https://github.com/simple-icons/simple-icons) where available
	// Icons are rendered with viewBox="0 0 24 24" to match simple-icons standard
	export const PROVIDER_ICONS: Record<string, { body: string; color?: string }> = {
		// === LLM Providers ===

		// OpenAI - custom icon (not in simple-icons)
		openai: {
			body: '<path fill="currentColor" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>',
			color: '#412991'
		},

		// Anthropic - from simple-icons
		anthropic: {
			body: '<path fill="currentColor" d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/>',
			color: '#191919'
		},

		// OpenRouter - from simple-icons
		openrouter: {
			body: '<path fill="currentColor" d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z"/>',
			color: '#94A3B8'
		},

		// Custom Endpoint - generic plug icon
		'custom-endpoint': {
			body: '<path fill="currentColor" d="M16 2a2 2 0 0 1 2 2v4h-2V4H4v16h12v-2h2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12zm5.5 7a2.5 2.5 0 0 1 2.5 2.5v1a2.5 2.5 0 0 1-2.5 2.5H14v-2h7.5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5H14V9h7.5z"/><circle cx="10" cy="12" r="2" fill="var(--color-neutral-50, #fafafa)"/>',
			color: '#6366F1'
		},

		// === TTS Providers ===

		// ElevenLabs - from simple-icons
		elevenlabs: {
			body: '<path fill="currentColor" d="M4.6035 0v24h4.9317V0zm9.8613 0v24h4.9317V0z"/>',
			color: '#000000'
		},

		// AllTalk - custom icon
		alltalk: {
			body: '<path fill="currentColor" d="M12 3a7 7 0 0 0-7 7v3a7 7 0 0 0 4 6.32V21h6v-1.68A7 7 0 0 0 19 13v-3a7 7 0 0 0-7-7zm-2 17v-1h4v1h-4zm-2-8V10a4 4 0 0 1 8 0v2a4 4 0 0 1-8 0z"/>',
			color: '#14B8A6'
		},

		// Chatterbox - custom icon
		chatterbox: {
			body: '<path fill="currentColor" d="M4 4h16v10h-5l-3 3-3-3H4V4zm3 4v2h10V8H7z"/>',
			color: '#EC4899'
		},

		// OmniVoice - globe/wave icon
		omnivoice: {
			body: '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>',
			color: '#6366F1'
		},

		// OpenAI TTS - same as OpenAI
		'openai-tts': {
			body: '<path fill="currentColor" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/>',
			color: '#412991'
		},

		// === STT Providers ===

		// Web Speech API - custom icon
		'web-speech': {
			body: '<path fill="currentColor" d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zm7 10a7 7 0 01-14 0H3a9 9 0 0018 0h-2zm-7 7a7 7 0 01-7-7H3a9 9 0 009 9v-2z"/>'
		},

		// Local Whisper STT
		'whisper-local': {
			body: '<path fill="currentColor" d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zm-1 13.93V18h-2v2h6v-2h-2v-2.07A8 8 0 0020 8h-2a6 6 0 01-12 0H4a8 8 0 007 7.93zM9 5a3 3 0 016 0v7a3 3 0 01-6 0V5z"/>',
			color: '#0EA5E9'
		},

		// Groq STT - custom icon
		'groq-stt': {
			body: '<g fill="currentColor"><circle cx="12" cy="12" r="10" fill-opacity=".2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="var(--color-neutral-50, #fafafa)"/></g>',
			color: '#F55036'
		},

		// Generic fallback icon
		generic: {
			body: '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>'
		}
	};
</script>

<script lang="ts">
	interface Props {
		provider: string;
		size?: number;
		class?: string;
		themed?: boolean;
	}

	let { provider, size = 24, class: className = '', themed = false }: Props = $props();

	const icon = $derived(PROVIDER_ICONS[provider] || PROVIDER_ICONS.generic);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	class={className}
	style={!themed && icon.color ? `color: ${icon.color}` : undefined}
>
	{@html icon.body}
</svg>

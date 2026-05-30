<script lang="ts">
	import { chatStore } from '$lib/stores/chat.svelte';
	import { displayStore } from '$lib/stores/display.svelte';
	import { Icon } from '$lib/components/ui';
	import { tick } from 'svelte';

	interface Props {
		open: boolean;
		onClose?: () => void;
		/** Current sentence being spoken by TTS – replaces last assistant message content while active */
		speakingText?: string;
		isTyping?: boolean;
	}

	let { open, onClose, speakingText = '', isTyping = false }: Props = $props();

	let messagesEl: HTMLDivElement | null = null;

	// Auto-scroll whenever messages change OR when new TTS sentence arrives
	$effect(() => {
		const _msgs = chatStore.messages.length;
		const _sentence = speakingText;
		if (open && messagesEl) {
			tick().then(() => {
				if (messagesEl) {
					messagesEl.scrollTop = messagesEl.scrollHeight;
				}
			});
		}
	});

	// The last assistant message id – used to show TTS sentence instead of full content
	const lastAssistantId = $derived(
		[...chatStore.messages].reverse().find((m) => m.role === 'assistant')?.id ?? null
	);

	function togglePosition() {
		displayStore.setSidebarPosition(displayStore.sidebarPosition === 'right' ? 'left' : 'right');
	}
</script>

<div
	class="sidebar"
	class:open
	class:left={displayStore.sidebarPosition === 'left'}
	class:right={displayStore.sidebarPosition === 'right'}
>
	<div class="sidebar-header">
		{#if displayStore.sidebarPosition === 'right'}
			<button class="dock-btn" onclick={togglePosition} aria-label="Dock sidebar to left" title="Dock left">
				<Icon name="chevron-left" size={16} />
			</button>
		{/if}
		<span class="sidebar-title">Chat History</span>
		{#if displayStore.sidebarPosition === 'left'}
			<button class="dock-btn" onclick={togglePosition} aria-label="Dock sidebar to right" title="Dock right">
				<Icon name="chevron-right" size={16} />
			</button>
		{/if}
		<button class="close-btn" onclick={onClose} aria-label="Close chat history">✕</button>
	</div>

	<div class="messages" bind:this={messagesEl}>
		{#if chatStore.messages.length === 0}
			<p class="empty-hint">No messages yet.</p>
		{:else}
			{#each chatStore.messages as msg (msg.id)}
				{@const isLastAssistant = msg.id === lastAssistantId && msg.role === 'assistant'}
				{@const displayText = isLastAssistant && (speakingText || isTyping)
					? speakingText
					: msg.content}
				<div class="message" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
					<div class="bubble" class:speaking={isLastAssistant && (speakingText || isTyping)}>
						{#if isLastAssistant && isTyping && !speakingText}
							<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
						{:else}
							<p>{displayText}</p>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.sidebar {
		position: fixed;
		top: 0;
		bottom: 0;
		width: 320px;
		max-width: 85vw;
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(245,245,245,0.92) 100%);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		z-index: 45;
		pointer-events: none;
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.sidebar.right {
		right: 0;
		border-left: 1px solid rgba(0, 0, 0, 0.08);
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1), -1px 0 6px rgba(0, 0, 0, 0.06);
		transform: translateX(100%);
	}

	.sidebar.left {
		left: 0;
		border-right: 1px solid rgba(0, 0, 0, 0.08);
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.1), 1px 0 6px rgba(0, 0, 0, 0.06);
		transform: translateX(-100%);
	}

	.sidebar.open {
		transform: translateX(0);
		pointer-events: auto;
	}

	:global(.dark) .sidebar {
		background: linear-gradient(180deg, rgba(30,30,30,0.95) 0%, rgba(22,22,22,0.95) 100%);
	}

	:global(.dark) .sidebar.right {
		border-left-color: rgba(255, 255, 255, 0.08);
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4), -1px 0 6px rgba(0, 0, 0, 0.3);
	}

	:global(.dark) .sidebar.left {
		border-right-color: rgba(255, 255, 255, 0.08);
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4), 1px 0 6px rgba(0, 0, 0, 0.3);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 1rem 0.75rem 0.75rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		flex-shrink: 0;
	}

	:global(.dark) .sidebar-header {
		border-bottom-color: rgba(255, 255, 255, 0.08);
	}

	.sidebar-title {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		letter-spacing: 0.02em;
	}

	:global(.dark) .sidebar-title {
		color: #fafafa;
	}

	.dock-btn,
	.close-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		border-radius: 8px;
		color: var(--text-secondary, #666);
		cursor: pointer;
		font-size: 0.8rem;
		transition: background 0.15s, color 0.15s;
		flex-shrink: 0;
	}

	.dock-btn:hover,
	.close-btn:hover {
		background: rgba(0, 0, 0, 0.08);
		color: var(--text-primary, #1a1a1a);
	}

	:global(.dark) .dock-btn:hover,
	:global(.dark) .close-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #fafafa;
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		scroll-behavior: smooth;
	}

	.messages::-webkit-scrollbar {
		width: 6px;
	}

	.messages::-webkit-scrollbar-track {
		background: transparent;
	}

	.messages::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.15);
		border-radius: 3px;
	}

	:global(.dark) .messages::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.15);
	}

	.message {
		display: flex;
	}

	.message.user {
		justify-content: flex-end;
	}

	.message.assistant {
		justify-content: flex-start;
	}

	.bubble {
		max-width: 85%;
		padding: 0.5rem 0.75rem;
		border-radius: 14px;
		font-size: 0.8125rem;
		line-height: 1.5;
		word-wrap: break-word;
	}

	.user .bubble {
		background: linear-gradient(180deg, #01c4ff 0%, #01B2FF 100%);
		color: white;
		border-bottom-right-radius: 4px;
		box-shadow: 0 2px 8px rgba(1, 178, 255, 0.3);
	}

	.assistant .bubble {
		background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
		color: #1a1a1a;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-bottom-left-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	:global(.dark) .assistant .bubble {
		background: linear-gradient(180deg, #2a2a2a 0%, #222222 100%);
		color: #fafafa;
		border-color: rgba(255, 255, 255, 0.08);
	}

	.bubble p {
		margin: 0;
	}

	.empty-hint {
		text-align: center;
		font-size: 0.8125rem;
		color: var(--text-secondary, #999);
		margin-top: 2rem;
	}

	.bubble.speaking {
		border-color: rgba(1, 196, 255, 0.35);
		box-shadow: 0 2px 8px rgba(1, 196, 255, 0.15);
	}

	:global(.dark) .bubble.speaking {
		border-color: rgba(1, 196, 255, 0.25);
	}

	.typing-dots {
		display: inline-flex;
		gap: 3px;
		align-items: center;
		height: 1.2em;
	}

	.typing-dots span {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
		animation: dot-bounce 1.2s ease-in-out infinite;
	}

	.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
	.typing-dots span:nth-child(3) { animation-delay: 0.4s; }

	@keyframes dot-bounce {
		0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
		40% { transform: translateY(-4px); opacity: 1; }
	}
</style>

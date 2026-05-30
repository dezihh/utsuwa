<script lang="ts">
	import { chatStore } from '$lib/stores/chat.svelte';
	import { tick } from 'svelte';

	interface Props {
		open: boolean;
		onClose?: () => void;
	}

	let { open, onClose }: Props = $props();

	let messagesEl: HTMLDivElement | null = null;

	// Auto-scroll to bottom when new messages arrive
	$effect(() => {
		const _ = chatStore.messages.length;
		if (open && messagesEl) {
			tick().then(() => {
				if (messagesEl) {
					messagesEl.scrollTop = messagesEl.scrollHeight;
				}
			});
		}
	});
</script>

<div class="sidebar-overlay" class:open>
	<div class="sidebar" class:open>
		<div class="sidebar-header">
			<span class="sidebar-title">Chat History</span>
			<button class="close-btn" onclick={onClose} aria-label="Close chat history">✕</button>
		</div>

		<div class="messages" bind:this={messagesEl}>
			{#if chatStore.messages.length === 0}
				<p class="empty-hint">No messages yet.</p>
			{:else}
				{#each chatStore.messages as msg (msg.id)}
					<div class="message" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
						<div class="bubble">
							<p>{msg.content}</p>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.sidebar-overlay {
		position: fixed;
		inset: 0;
		z-index: 45;
		pointer-events: none;
	}

	.sidebar {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 320px;
		max-width: 85vw;
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(245,245,245,0.92) 100%);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border-left: 1px solid rgba(0, 0, 0, 0.08);
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1), -1px 0 6px rgba(0, 0, 0, 0.06);
		transform: translateX(100%);
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
	}

	.sidebar.open {
		transform: translateX(0);
		pointer-events: auto;
	}

	:global(.dark) .sidebar {
		background: linear-gradient(180deg, rgba(30,30,30,0.95) 0%, rgba(22,22,22,0.95) 100%);
		border-left-color: rgba(255, 255, 255, 0.08);
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4), -1px 0 6px rgba(0, 0, 0, 0.3);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1rem 0.75rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		flex-shrink: 0;
	}

	:global(.dark) .sidebar-header {
		border-bottom-color: rgba(255, 255, 255, 0.08);
	}

	.sidebar-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		letter-spacing: 0.02em;
	}

	:global(.dark) .sidebar-title {
		color: #fafafa;
	}

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
	}

	.close-btn:hover {
		background: rgba(0, 0, 0, 0.08);
		color: var(--text-primary, #1a1a1a);
	}

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
</style>

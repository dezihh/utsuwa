<script lang="ts">
	import { goto } from '$app/navigation';
	import { Icon } from '$lib/components/ui';
	import { isTauri } from '$lib/services/platform';
	import { onMount } from 'svelte';
	import type { Reminder } from '$lib/types/memory';

	interface Props {
		onInfoClick: () => void;
		sidebarOpen?: boolean;
		onToggleSidebar?: () => void;
		showSidebarBtn?: boolean;
		rightOffset?: number;
		upcomingReminders?: Reminder[];
		onDeleteReminder?: (id: number) => void;
	}

	let { onInfoClick, sidebarOpen = false, onToggleSidebar, showSidebarBtn = false, rightOffset = 0, upcomingReminders = [], onDeleteReminder }: Props = $props();
	let showOverlayBtn = $state(false);
	let remindersOpen = $state(false);

	onMount(() => {
		showOverlayBtn = isTauri();
	});

	async function launchOverlay() {
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			const { getCurrentWindow } = await import('@tauri-apps/api/window');

			// Show overlay and hide main window
			await invoke('show_overlay');
			const mainWindow = getCurrentWindow();
			await mainWindow.hide();
		} catch (e) {
			console.error('Failed to launch overlay:', e);
		}
	}

	function formatTimeLabel(date: Date): string {
		const now = new Date();
		const diffMs = date.getTime() - now.getTime();
		const diffMin = Math.max(0, Math.ceil(diffMs / 60000));
		if (diffMin < 60) return `in ${diffMin} min`;
		const diffH = Math.ceil(diffMin / 60);
		return `in ${diffH} h`;
	}

	function deleteReminder(id?: number) {
		if (id === undefined) return;
		remindersOpen = false;
		onDeleteReminder?.(id);
	}
</script>

<div class="top-right-buttons" style="right: calc(1rem + {rightOffset}px)">
	<div class="reminder-wrapper">
		<button
			class="icon-btn"
			class:active={remindersOpen}
			onclick={() => (remindersOpen = !remindersOpen)}
			aria-label="Open reminders"
			title="Open reminders"
		>
			<Icon name="bell" size={20} />
			{#if upcomingReminders.length > 0}
				<span class="reminder-badge">{upcomingReminders.length}</span>
			{/if}
		</button>
		{#if remindersOpen}
			<div class="reminder-dropdown">
				<div class="reminder-header">Open tasks</div>
				{#if upcomingReminders.length === 0}
					<div class="reminder-empty">No open tasks or timers</div>
				{:else}
					<ul class="reminder-list">
						{#each upcomingReminders as reminder (reminder.id)}
							<li class="reminder-item">
								<div class="reminder-text">
									<span class="reminder-content">{reminder.content}</span>
									<span class="reminder-time">{formatTimeLabel(reminder.triggerAt)}</span>
								</div>
								<button
									class="reminder-delete"
									onclick={() => deleteReminder(reminder.id)}
									aria-label="Delete reminder"
									title="Delete reminder"
								>
									<Icon name="trash" size={14} />
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
	{#if showOverlayBtn}
		<button class="icon-btn overlay-btn" onclick={launchOverlay} aria-label="Launch overlay" title="Launch Overlay Mode">
			<Icon name="monitor" size={20} />
		</button>
	{/if}
	{#if showSidebarBtn}
		<button
			class="icon-btn"
			class:active={sidebarOpen}
			onclick={onToggleSidebar}
			aria-label="Toggle chat history"
			title="Chat History"
		>
			<Icon name="message-square" size={20} />
		</button>
	{/if}
	<button class="icon-btn" onclick={onInfoClick} aria-label="App info">
		<Icon name="info" size={20} />
	</button>
	<button class="icon-btn" onclick={() => goto('/app/settings')} aria-label="Settings">
		<Icon name="settings" size={20} />
	</button>
</div>

<style>
	.top-right-buttons {
		position: fixed;
		top: 1rem;
		right: 1rem; /* overridden by inline style when sidebar open */
		z-index: 46;
		display: flex;
		gap: 0.5rem;
		transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease-out;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.1),
			0 1px 3px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
		position: relative;
	}

	:global(.dark) .icon-btn {
		background: linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.35),
			0 1px 3px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.icon-btn:hover {
		background: linear-gradient(180deg, #f8f8f8 0%, #e8e8e8 100%);
		border-color: rgba(1, 178, 255, 0.3);
		color: var(--text-primary);
		transform: translateY(-2px);
		box-shadow:
			0 6px 16px rgba(0, 0, 0, 0.12),
			0 2px 6px rgba(0, 0, 0, 0.08),
			0 0 0 2px rgba(1, 178, 255, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .icon-btn:hover {
		background: linear-gradient(180deg, #333333 0%, #282828 100%);
		box-shadow:
			0 6px 16px rgba(0, 0, 0, 0.45),
			0 2px 6px rgba(0, 0, 0, 0.25),
			0 0 0 2px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.icon-btn:focus {
		outline: none;
		border-color: #01B2FF;
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.1),
			0 0 0 3px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .icon-btn:focus {
		box-shadow:
			0 3px 10px rgba(0, 0, 0, 0.35),
			0 0 0 3px rgba(1, 178, 255, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.icon-btn:active {
		transform: translateY(0) scale(0.97);
		box-shadow:
			0 1px 4px rgba(0, 0, 0, 0.1),
			inset 0 2px 4px rgba(0, 0, 0, 0.06);
	}

	:global(.dark) .icon-btn:active {
		box-shadow:
			0 1px 4px rgba(0, 0, 0, 0.3),
			inset 0 2px 4px rgba(0, 0, 0, 0.2);
	}

	/* Active state (e.g. sidebar open) */
	.icon-btn.active {
		background: linear-gradient(180deg, #66d9ff 0%, #01B2FF 100%);
		color: white;
		border-color: rgba(0, 0, 0, 0.1);
		box-shadow:
			0 3px 10px rgba(1, 178, 255, 0.35),
			0 1px 3px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	:global(.dark) .icon-btn.active {
		background: linear-gradient(180deg, #01B2FF 0%, #0099dd 100%);
	}

	/* Overlay button - accent color */
	.overlay-btn {
		background: linear-gradient(180deg, #66d9ff 0%, #01B2FF 100%);
		color: white;
		border-color: rgba(0, 0, 0, 0.1);
	}

	.overlay-btn:hover {
		background: linear-gradient(180deg, #80e0ff 0%, #1ebfff 100%);
		color: white;
	}

	:global(.dark) .overlay-btn {
		background: linear-gradient(180deg, #01B2FF 0%, #0099dd 100%);
	}

	:global(.dark) .overlay-btn:hover {
		background: linear-gradient(180deg, #1ebfff 0%, #00a6e6 100%);
	}

	.reminder-wrapper {
		position: relative;
	}

	.reminder-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		background: #ff4757;
		color: white;
		font-size: 10px;
		font-weight: 700;
		border-radius: 9px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
	}

	.reminder-dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		width: 280px;
		max-height: 320px;
		overflow-y: auto;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 0.75rem;
		box-shadow:
			0 10px 30px rgba(0, 0, 0, 0.12),
			0 2px 8px rgba(0, 0, 0, 0.08);
		z-index: 60;
	}

	:global(.dark) .reminder-dropdown {
		background: rgba(40, 40, 40, 0.95);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow:
			0 10px 30px rgba(0, 0, 0, 0.45),
			0 2px 8px rgba(0, 0, 0, 0.25);
	}

	.reminder-header {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 0.5rem;
		padding: 0 0.25rem;
	}

	.reminder-empty {
		font-size: 0.85rem;
		color: var(--text-muted);
		padding: 0.75rem 0.25rem;
		text-align: center;
	}

	.reminder-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.reminder-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem;
		background: rgba(0, 0, 0, 0.03);
		border-radius: 10px;
		transition: background 0.15s ease;
	}

	:global(.dark) .reminder-item {
		background: rgba(255, 255, 255, 0.05);
	}

	.reminder-item:hover {
		background: rgba(1, 178, 255, 0.08);
	}

	.reminder-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	.reminder-content {
		font-size: 0.85rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.reminder-time {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.reminder-delete {
		width: 26px;
		height: 26px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.reminder-delete:hover {
		background: rgba(255, 71, 87, 0.12);
		color: #ff4757;
	}
</style>

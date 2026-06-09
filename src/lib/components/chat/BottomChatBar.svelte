<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import { sttStore } from '$lib/stores/stt.svelte';
	import { unlockAudioContext } from '$lib/services/tts/index';
	import AudioVisualizer from './AudioVisualizer.svelte';
	import type { DuplexPhase } from '$lib/stores/duplex.svelte';

	interface Props {
		onSend: (content: string) => void;
		disabled?: boolean;
		isDuplexActive?: boolean;
		duplexPhase?: DuplexPhase;
		duplexAudioLevel?: number;
		duplexNoiseDetected?: boolean;
		duplexSensitivity?: number;
		onToggleDuplex?: () => void;
		onAdjustSensitivity?: (delta: number) => void;
	}

	let {
		onSend,
		disabled = false,
		isDuplexActive = false,
		duplexPhase = 'idle',
		duplexAudioLevel = 0,
		duplexNoiseDetected = false,
		duplexSensitivity = 1.0,
		onToggleDuplex,
		onAdjustSensitivity
	}: Props = $props();
	let inputValue = $state('');
	let textareaRef: HTMLTextAreaElement = $state()!;

	const isListening = $derived(sttStore.isListening);
	const isTranscribing = $derived(sttStore.isTranscribing);
	const audioLevel = $derived(sttStore.audioLevel);
	const displayTranscript = $derived(sttStore.displayTranscript);
	const sttError = $derived(sttStore.error);

	// Track if there's content to send
	const hasContent = $derived(inputValue.trim().length > 0 || displayTranscript.trim().length > 0);

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		unlockAudioContext();
		if (inputValue.trim() && !disabled) {
			onSend(inputValue.trim());
			inputValue = '';
			if (textareaRef) {
				textareaRef.style.height = 'auto';
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			unlockAudioContext();
			if (inputValue.trim() && !disabled) {
				onSend(inputValue.trim());
				inputValue = '';
				if (textareaRef) {
					textareaRef.style.height = 'auto';
				}
			}
		}
	}

	function handleInput() {
		if (textareaRef) {
			textareaRef.style.height = 'auto';
			textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + 'px';
		}
	}

	function handleMicClick() {
		if (!sttStore.isSupported()) {
			sttStore.showUnsupportedError();
			return;
		}
		if (isListening) {
			sttStore.stopListening();
		} else {
			sttStore.startListening((text) => {
				onSend(text);
			});
		}
	}

	function handleCancelRecording() {
		sttStore.cancel();
	}

	function handleSendClick() {
		unlockAudioContext();
		if (isListening && displayTranscript.trim()) {
			const text = displayTranscript.trim();
			sttStore.cancel();
			onSend(text);
		} else if (inputValue.trim() && !disabled) {
			onSend(inputValue.trim());
			inputValue = '';
			if (textareaRef) {
				textareaRef.style.height = 'auto';
			}
		}
	}

	const duplexPhaseLabel: Record<DuplexPhase, string> = {
		idle: '',
		listening: 'Listening...',
		recording: 'Recording...',
		transcribing: 'Transcribing...',
		thinking: 'Thinking...',
		speaking: 'Speaking...'
	};
</script>

{#if sttError}
	<div class="stt-error" onclick={() => sttStore.clearError()} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sttStore.clearError(); } }}>
		<Icon name="alert" size={16} />
		<span>{sttError}</span>
		<button type="button" class="dismiss-btn" aria-label="Dismiss">
			<Icon name="x" size={14} />
		</button>
	</div>
{/if}

<div class="bottom-chat-bar">
	<form class="chat-form" onsubmit={handleSubmit}>
		<div
			class="input-wrapper"
			class:recording={isListening || duplexPhase === 'recording'}
			class:transcribing={isTranscribing || duplexPhase === 'transcribing'}
			class:duplex-active={isDuplexActive}
			class:focused={hasContent && !isDuplexActive}
		>
			{#if isDuplexActive}
				<!-- Duplex mode: show phase status -->
				<button
					type="button"
					class="mic-btn duplex-btn"
					class:duplex-listening={duplexPhase === 'listening'}
					class:duplex-recording={duplexPhase === 'recording'}
					class:duplex-speaking={duplexPhase === 'speaking'}
					onclick={onToggleDuplex}
					aria-label="Stop duplex mode"
					title="Stop voice conversation"
				>
					<Icon name="headset" size={18} />
				</button>
				{#if duplexPhase === 'recording'}
					<AudioVisualizer audioLevel={duplexAudioLevel} transcript="" />
				{:else}
					<div class="duplex-status">
						<span class="duplex-phase-dot" class:pulse={duplexPhase === 'listening' || duplexPhase === 'thinking' || duplexPhase === 'speaking'}></span>
						{#if duplexNoiseDetected}
							<span class="duplex-noise-toast">🔊 Background noise</span>
						{:else}
							<span class="duplex-phase-label">{duplexPhaseLabel[duplexPhase]}</span>
						{/if}
					</div>
				{/if}
				<!-- Sensitivity controls: always visible in duplex mode -->
				{#if onAdjustSensitivity && duplexPhase !== 'recording'}
					<div class="sensitivity-controls">
						<button
							type="button"
							class="sens-btn"
							onclick={() => onAdjustSensitivity(-1)}
							title="Less sensitive (ignore background noise)"
							aria-label="Decrease sensitivity"
						>−</button>
						<span class="sens-label" title="Sensitivity: {duplexSensitivity}/10">
							{duplexSensitivity}
						</span>
						<button
							type="button"
							class="sens-btn"
							onclick={() => onAdjustSensitivity(1)}
							title="More sensitive (detect quieter speech)"
							aria-label="Increase sensitivity"
						>+</button>
					</div>
				{/if}
			{:else if isTranscribing}
				<button type="button" class="mic-btn recording" disabled aria-label="Transcribing">
					<Icon name="loader" size={20} />
				</button>
				<div class="transcribing-label">Transcribing...</div>
			{:else if isListening}
				<button
					type="button"
					class="mic-btn recording"
					onclick={() => sttStore.stopListening()}
					aria-label="Stop recording"
					title="Stop recording"
				>
					<Icon name="stop" size={16} />
				</button>
				<AudioVisualizer {audioLevel} transcript={displayTranscript} />
			{:else}
				<button
					type="button"
					class="mic-btn"
					onclick={handleMicClick}
					aria-label="Voice input"
					title="Voice input"
				>
					<Icon name="mic" size={20} />
				</button>
				<!-- svelte-ignore a11y_autofocus -->
	<textarea
					bind:this={textareaRef}
					bind:value={inputValue}
					onkeydown={handleKeydown}
					oninput={handleInput}
					placeholder="Type a message..."
					rows="1"
					{disabled}
				></textarea>
			{/if}
			<button
				type="button"
				class="send-btn"
				class:has-content={hasContent}
				onclick={handleSendClick}
				disabled={disabled || isTranscribing || !hasContent}
				aria-label={hasContent ? "Send message" : "Waiting for input"}
			>
				<span class="send-icon">
					<Icon name="send" size={20} />
				</span>
				<span class="btn-shine"></span>
			</button>
			<!-- Duplex toggle button (always visible when STT provider is whisper-local) -->
			{#if onToggleDuplex}
				<button
					type="button"
					class="duplex-toggle-btn"
					class:active={isDuplexActive}
					onclick={onToggleDuplex}
					aria-label={isDuplexActive ? 'Stop voice conversation' : 'Start voice conversation (duplex)'}
					title={isDuplexActive ? 'Stop voice conversation' : 'Voice conversation mode'}
				>
					<Icon name="headset" size={16} />
				</button>
			{/if}
		</div>
	</form>
</div>

<style>
	.bottom-chat-bar {
		position: fixed;
		bottom: 2.5rem;
		left: 50%;
		transform: translateX(-50%);
		width: 100%;
		max-width: 600px;
		padding: 0 1rem;
		z-index: 40;
	}

	.stt-error {
		position: fixed;
		top: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		width: fit-content;
		max-width: 600px;
		background: linear-gradient(180deg, #ff6b6b 0%, #ee5a5a 100%);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 16px;
		color: white;
		font-size: 0.875rem;
		cursor: pointer;
		z-index: 50;
		animation: slideDownShake 0.5s ease-out;
		box-shadow:
			0 4px 20px rgba(238, 90, 90, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
	}

	@keyframes slideDownShake {
		0% {
			opacity: 0;
			transform: translateX(-50%) translateY(-8px);
		}
		30% {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
		45% {
			transform: translateX(calc(-50% + 6px)) translateY(0);
		}
		60% {
			transform: translateX(calc(-50% - 5px)) translateY(0);
		}
		75% {
			transform: translateX(calc(-50% + 3px)) translateY(0);
		}
		90% {
			transform: translateX(calc(-50% - 2px)) translateY(0);
		}
		100% {
			transform: translateX(-50%) translateY(0);
		}
	}

	.stt-error span {
		flex: 1;
		word-wrap: break-word;
	}

	.dismiss-btn {
		background: rgba(255, 255, 255, 0.2);
		border: none;
		padding: 0.25rem;
		border-radius: 6px;
		cursor: pointer;
		color: white;
		opacity: 0.9;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
	}

	.dismiss-btn:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.3);
	}

	.chat-form {
		width: 100%;
	}

	/* PS2/Y2K style glossy input wrapper */
	.input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.98) 0%,
			rgba(250, 250, 252, 0.95) 50%,
			rgba(245, 245, 248, 0.98) 100%
		);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 2px solid rgba(255, 255, 255, 0.8);
		border-radius: 28px;
		padding: 0.5rem;
		min-height: 56px;
		/* Layered shadows for depth */
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.06),
			0 4px 20px rgba(0, 0, 0, 0.08),
			0 8px 32px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 1),
			inset 0 -1px 0 rgba(0, 0, 0, 0.03);
		transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(.dark) .input-wrapper {
		background: linear-gradient(
			180deg,
			rgba(45, 45, 50, 0.98) 0%,
			rgba(38, 38, 42, 0.95) 50%,
			rgba(32, 32, 36, 0.98) 100%
		);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.3),
			0 4px 20px rgba(0, 0, 0, 0.3),
			0 8px 32px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2);
	}

	.input-wrapper:focus-within,
	.input-wrapper.focused {
		border-color: rgba(1, 178, 255, 0.5);
		box-shadow:
			0 0 0 1px rgba(1, 178, 255, 0.2),
			0 0 0 4px rgba(1, 178, 255, 0.1),
			0 4px 20px rgba(0, 0, 0, 0.08),
			0 0 30px rgba(1, 178, 255, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 1);
	}

	:global(.dark) .input-wrapper:focus-within,
	:global(.dark) .input-wrapper.focused {
		border-color: rgba(1, 178, 255, 0.4);
		box-shadow:
			0 0 0 1px rgba(1, 178, 255, 0.3),
			0 0 0 4px rgba(1, 178, 255, 0.15),
			0 4px 20px rgba(0, 0, 0, 0.3),
			0 0 40px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.input-wrapper.recording {
		border-color: rgba(1, 178, 255, 0.6);
		box-shadow:
			0 0 0 1px rgba(1, 178, 255, 0.3),
			0 0 0 4px rgba(1, 178, 255, 0.15),
			0 4px 20px rgba(0, 0, 0, 0.08),
			0 0 30px rgba(1, 178, 255, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 1);
		animation: pulse-glow 2s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% {
			box-shadow:
				0 0 0 1px rgba(1, 178, 255, 0.3),
				0 0 0 4px rgba(1, 178, 255, 0.15),
				0 4px 20px rgba(0, 0, 0, 0.08),
				0 0 30px rgba(1, 178, 255, 0.2),
				inset 0 1px 0 rgba(255, 255, 255, 1);
		}
		50% {
			box-shadow:
				0 0 0 1px rgba(1, 178, 255, 0.4),
				0 0 0 6px rgba(1, 178, 255, 0.1),
				0 4px 20px rgba(0, 0, 0, 0.08),
				0 0 40px rgba(1, 178, 255, 0.3),
				inset 0 1px 0 rgba(255, 255, 255, 1);
		}
	}

	.input-wrapper.transcribing {
		border-color: rgba(1, 178, 255, 0.4);
	}

	.transcribing-label {
		flex: 1;
		padding: 0.625rem 0.5rem;
		font-size: 0.9rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	.mic-btn.recording:disabled {
		opacity: 0.7;
		cursor: wait;
		animation: none;
	}

	textarea {
		flex: 1;
		padding: 0.625rem 0.5rem;
		border: none;
		background: transparent;
		color: var(--text-primary);
		font-size: 1rem;
		resize: none;
		outline: none;
		font-family: inherit;
		line-height: 1.5;
		max-height: 120px;
	}

	textarea::placeholder {
		color: var(--text-tertiary);
	}

	textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Glossy Y2K buttons */
	.mic-btn,
	.send-btn {
		width: 44px;
		height: 44px;
		border: none;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		flex-shrink: 0;
		position: relative;
		overflow: hidden;
	}

	.mic-btn {
		background: linear-gradient(
			180deg,
			#ffffff 0%,
			#f0f0f2 50%,
			#e8e8ea 100%
		);
		color: var(--text-tertiary);
		border: 1px solid rgba(0, 0, 0, 0.08);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 1),
			inset 0 -1px 0 rgba(0, 0, 0, 0.04);
	}

	:global(.dark) .mic-btn {
		background: linear-gradient(
			180deg,
			#3a3a3e 0%,
			#2e2e32 50%,
			#262628 100%
		);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2);
	}

	.mic-btn:hover:not(:disabled) {
		color: var(--text-primary);
		transform: translateY(-2px);
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 1),
			inset 0 -1px 0 rgba(0, 0, 0, 0.04);
	}

	:global(.dark) .mic-btn:hover:not(:disabled) {
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
	}

	.mic-btn:active:not(:disabled) {
		transform: translateY(0) scale(0.96);
	}

	.mic-btn.recording {
		background: linear-gradient(
			180deg,
			#66d9ff 0%,
			#4dd0ff 30%,
			#01B2FF 70%,
			#0099dd 100%
		);
		color: white;
		border-color: rgba(0, 0, 0, 0.1);
		animation: recording-pulse 1.5s ease-in-out infinite;
		box-shadow:
			0 4px 16px rgba(1, 178, 255, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
	}

	.mic-btn.recording:hover {
		background: linear-gradient(
			180deg,
			#80e0ff 0%,
			#66d9ff 30%,
			#1ebfff 70%,
			#00a6e6 100%
		);
	}

	@keyframes recording-pulse {
		0%, 100% {
			box-shadow:
				0 4px 16px rgba(1, 178, 255, 0.5),
				0 0 0 0 rgba(1, 178, 255, 0.4),
				inset 0 1px 0 rgba(255, 255, 255, 0.4);
		}
		50% {
			box-shadow:
				0 4px 16px rgba(1, 178, 255, 0.5),
				0 0 0 8px rgba(1, 178, 255, 0),
				inset 0 1px 0 rgba(255, 255, 255, 0.4);
		}
	}

	/* Send button - starts subtle, becomes vibrant when has content */
	.send-btn {
		background: linear-gradient(
			180deg,
			#e8e8ea 0%,
			#dcdcde 50%,
			#d0d0d2 100%
		);
		color: var(--text-tertiary);
		border: 1px solid rgba(0, 0, 0, 0.06);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .send-btn {
		background: linear-gradient(
			180deg,
			#2a2a2e 0%,
			#242428 50%,
			#1e1e22 100%
		);
		border-color: rgba(255, 255, 255, 0.06);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.send-icon {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.btn-shine {
		position: absolute;
		top: 0;
		left: 0;
		right: 50%;
		height: 50%;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.4) 0%,
			rgba(255, 255, 255, 0) 100%
		);
		border-radius: 50% 50% 0 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	/* Active send button with content */
	.send-btn.has-content {
		background: linear-gradient(
			180deg,
			#66d9ff 0%,
			#4dd0ff 25%,
			#01B2FF 60%,
			#0099dd 100%
		);
		color: white;
		border-color: rgba(0, 0, 0, 0.1);
		box-shadow:
			0 4px 16px rgba(1, 178, 255, 0.45),
			0 2px 4px rgba(0, 0, 0, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.4),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
	}

	.send-btn.has-content .btn-shine {
		opacity: 1;
	}

	.send-btn.has-content:hover:not(:disabled) {
		background: linear-gradient(
			180deg,
			#80e0ff 0%,
			#66d9ff 25%,
			#1ebfff 60%,
			#00a6e6 100%
		);
		transform: translateY(-2px);
		box-shadow:
			0 6px 24px rgba(1, 178, 255, 0.55),
			0 3px 6px rgba(0, 0, 0, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.5),
			inset 0 -1px 0 rgba(0, 0, 0, 0.1);
	}

	.send-btn.has-content:active:not(:disabled) {
		transform: translateY(0) scale(0.96);
		background: linear-gradient(
			180deg,
			#01B2FF 0%,
			#0099dd 50%,
			#0088cc 100%
		);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.send-btn:disabled:not(.has-content) {
		cursor: default;
	}

	.send-btn.has-content:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.bottom-chat-bar {
			bottom: 1rem;
			max-width: none;
			padding: 0 0.75rem;
		}

		.stt-error {
			width: fit-content;
			max-width: calc(100vw - 1.5rem);
		}
	}

	/* ── Duplex mode styles ─────────────────────────────────────────────────── */

	.input-wrapper.duplex-active {
		border-color: rgba(16, 185, 129, 0.4);
		box-shadow:
			0 0 0 1px rgba(16, 185, 129, 0.2),
			0 0 0 4px rgba(16, 185, 129, 0.08),
			0 4px 20px rgba(0, 0, 0, 0.08),
			0 0 30px rgba(16, 185, 129, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 1);
	}

	:global(.dark) .input-wrapper.duplex-active {
		box-shadow:
			0 0 0 1px rgba(16, 185, 129, 0.3),
			0 0 0 4px rgba(16, 185, 129, 0.1),
			0 4px 20px rgba(0, 0, 0, 0.3),
			0 0 30px rgba(16, 185, 129, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.mic-btn.duplex-btn {
		background: linear-gradient(180deg, #6ee7b7 0%, #34d399 40%, #10b981 100%);
		color: white;
		border-color: rgba(0, 0, 0, 0.1);
		box-shadow:
			0 4px 12px rgba(16, 185, 129, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.35);
	}

	.mic-btn.duplex-btn.duplex-listening {
		animation: duplex-breathe 2.5s ease-in-out infinite;
	}

	.mic-btn.duplex-btn.duplex-recording {
		background: linear-gradient(180deg, #66d9ff 0%, #01B2FF 70%, #0099dd 100%);
		box-shadow:
			0 4px 16px rgba(1, 178, 255, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
		animation: recording-pulse 1.5s ease-in-out infinite;
	}

	.mic-btn.duplex-btn.duplex-speaking {
		background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%);
		box-shadow:
			0 4px 12px rgba(245, 158, 11, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.35);
		animation: duplex-breathe 1s ease-in-out infinite;
	}

	@keyframes duplex-breathe {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.85; transform: scale(0.97); }
	}

	.duplex-status {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.25rem;
	}

	.duplex-phase-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #10b981;
		flex-shrink: 0;
	}

	.duplex-phase-dot.pulse {
		animation: dot-pulse 1.5s ease-in-out infinite;
	}

	@keyframes dot-pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.75); }
	}

	.duplex-phase-label {
		font-size: 0.875rem;
		color: var(--text-secondary);
		font-style: italic;
	}

	.duplex-noise-toast {
		font-size: 0.8rem;
		color: #f59e0b;
		font-style: italic;
		animation: noise-fade 2s ease forwards;
	}

	@keyframes noise-fade {
		0% { opacity: 1; }
		70% { opacity: 1; }
		100% { opacity: 0; }
	}

	/* Sensitivity controls */
	.sensitivity-controls {
		display: flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
		margin-left: auto;
		padding-right: 0.15rem;
	}

	.sens-btn {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1px solid rgba(0,0,0,0.12);
		background: rgba(255,255,255,0.6);
		color: var(--text-secondary);
		font-size: 0.85rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: background 0.15s, color 0.15s;
	}

	:global(.dark) .sens-btn {
		background: rgba(255,255,255,0.08);
		border-color: rgba(255,255,255,0.12);
	}

	.sens-btn:hover {
		background: #10b981;
		color: white;
		border-color: transparent;
	}

	.sens-label {
		font-size: 0.65rem;
		color: var(--text-tertiary);
		min-width: 28px;
		text-align: center;
		cursor: default;
	}

	/* Small headset toggle button next to send */
	.duplex-toggle-btn {
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
		flex-shrink: 0;
		background: linear-gradient(180deg, #f0f0f2 0%, #e4e4e6 100%);
		color: var(--text-tertiary);
		border: 1px solid rgba(0, 0, 0, 0.07);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	:global(.dark) .duplex-toggle-btn {
		background: linear-gradient(180deg, #2e2e32 0%, #262628 100%);
		border-color: rgba(255, 255, 255, 0.08);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06);
	}

	.duplex-toggle-btn:hover {
		color: #10b981;
		transform: translateY(-1px);
		box-shadow: 0 3px 8px rgba(16, 185, 129, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.duplex-toggle-btn.active {
		background: linear-gradient(180deg, #6ee7b7 0%, #34d399 40%, #10b981 100%);
		color: white;
		border-color: rgba(0, 0, 0, 0.1);
		box-shadow: 0 3px 10px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}

	.duplex-toggle-btn.active:hover {
		background: linear-gradient(180deg, #86efac 0%, #4ade80 40%, #22c55e 100%);
		transform: translateY(-1px);
	}
</style>

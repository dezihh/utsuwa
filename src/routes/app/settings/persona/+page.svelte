<script lang="ts">
	import { pop, fadeFast, slideOpen } from '$lib/utils/motion';
	import { personaStore } from '$lib/stores/persona.svelte';
	import { characterStore } from '$lib/stores/character.svelte';
	import { vrmStore } from '$lib/stores/vrm.svelte';
	import { settingsStore, type PersonalityPreset } from '$lib/stores/settings.svelte';

	import { Icon, Progress, Tooltip, ProviderDropdown, ModelDropdown } from '$lib/components/ui';
	import VrmUploader from '$lib/components/vrm/VrmUploader.svelte';
	import { allEvents } from '$lib/data/events';
	import { getCompletedEvents } from '$lib/services/storage/events';
	import type { CompletedEventRecord, EventType } from '$lib/types/events';
	import { getKnownEmotionTags } from '$lib/utils/sentences';
	import type { EmotionMapping } from '$lib/services/vrm/expression-controller';

	// Character state - single companion system
	const charState = $derived.by(() => characterStore.state);
	const moodInfo = $derived.by(() => characterStore.moodInfo);
	const stageInfo = $derived.by(() => characterStore.stageInfo);
	const affectionPercent = $derived.by(() => characterStore.affectionPercent);
	const isCharacterLoading = $derived.by(() => characterStore.isLoading);
	const appMode = $derived.by(() => characterStore.appMode);
	const isDatingSimMode = $derived.by(() => characterStore.appMode === 'dating_sim');

	// Completed events with full records (includes dates)
	let completedEventRecords = $state<CompletedEventRecord[]>([]);

	// Load completed events from database
	$effect(() => {
		if (isDatingSimMode) {
			getCompletedEvents().then(records => {
				completedEventRecords = records;
			});
		}
	});

	// Achievement data with event definitions joined
	interface Achievement {
		id: string;
		name: string;
		type: EventType;
		completedAt: Date;
	}

	const achievements = $derived.by(() => {
		return completedEventRecords
			.map(record => {
				const eventDef = allEvents.find(e => e.id === record.eventId);
				if (!eventDef) return null;
				return {
					id: record.eventId,
					name: eventDef.name,
					type: eventDef.type,
					completedAt: record.completedAt
				} as Achievement;
			})
			.filter((a): a is Achievement => a !== null)
			.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
	});

	// Color and icon config for achievement types
	const achievementConfig: Record<EventType, { color: string; bgColor: string; icon: string; label: string }> = {
		milestone: { color: 'var(--ctp-yellow)', bgColor: 'var(--ctp-yellow)', icon: 'trophy', label: 'Milestone' },
		anniversary: { color: 'var(--ctp-pink)', bgColor: 'var(--ctp-pink)', icon: 'heart', label: 'Anniversary' },
		conditional: { color: 'var(--ctp-mauve)', bgColor: 'var(--ctp-mauve)', icon: 'award', label: 'Unlocked' },
		random: { color: 'var(--ctp-teal)', bgColor: 'var(--ctp-teal)', icon: 'sparkles', label: 'Surprise' },
		scheduled: { color: 'var(--ctp-blue)', bgColor: 'var(--ctp-blue)', icon: 'calendar', label: 'Event' }
	};

	function formatAchievementDate(date: Date): string {
		return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	// Persona form state
	let formName = $state('');
	let formSystemPrompt = $state('');
	let personalityExpanded = $state(false);

	// Personality profiles
	let editingProfileId = $state<string | null>(null);
	let editingProfileName = $state('');

	const activeProfileId = $derived(settingsStore.getActiveProfileId());
	const personalityProfiles = $derived(settingsStore.getPersonalityProfiles());
	const activeProfile = $derived(personalityProfiles.find((p) => p.id === activeProfileId) ?? personalityProfiles[0]);
	let expressionMappingExpanded = $state(false);
	let eventsExpanded = $state(false);
	let uploadModalOpen = $state(false);
	let editingModelId = $state<string | null>(null);
	let editingModelName = $state('');
	let modeConfirmOpen = $state(false);
	let pendingMode = $state<'companion' | 'dating_sim' | null>(null);
	const emotionTags = getKnownEmotionTags();


	// Load form values from store when character is ready
	$effect(() => {
		if (characterStore.isReady) {
			formName = personaStore.name;
			// If the active "Standard" profile is still empty, seed it from the character store
			const currentProfile = settingsStore.getPersonalityProfiles().find(
				(p) => p.id === settingsStore.getActiveProfileId()
			);
			if (currentProfile) {
				if (currentProfile.id === 'standard' && !currentProfile.systemPrompt && personaStore.systemPrompt) {
					settingsStore.updatePersonalityProfile('standard', { systemPrompt: personaStore.systemPrompt });
				}
				formSystemPrompt = currentProfile.id === 'standard' && !currentProfile.systemPrompt
					? personaStore.systemPrompt
					: currentProfile.systemPrompt;
			} else {
				formSystemPrompt = personaStore.systemPrompt;
			}
		}
	});

	function saveName() {
		personaStore.updateCard({ name: formName.trim() || 'Utsuwa' });
	}

	function saveSystemPrompt() {
		const id = settingsStore.getActiveProfileId();
		settingsStore.updatePersonalityProfile(id, { systemPrompt: formSystemPrompt });
		personaStore.updateCard({ systemPrompt: formSystemPrompt });
	}

	function startModelRename(model: { id: string; name: string }) {
		editingModelId = model.id;
		editingModelName = model.name;
	}

	function commitModelRename() {
		if (editingModelId) {
			vrmStore.renameModel(editingModelId, editingModelName);
		}
		editingModelId = null;
	}

	function switchProfile(profileId: string) {
		// Persist current textarea to current profile before switching
		const currentId = settingsStore.getActiveProfileId();
		settingsStore.updatePersonalityProfile(currentId, { systemPrompt: formSystemPrompt });
		// Switch
		settingsStore.setActiveProfileId(profileId);
		const next = settingsStore.getPersonalityProfiles().find((p) => p.id === profileId);
		if (next) {
			formSystemPrompt = next.systemPrompt;
			personaStore.updateCard({ systemPrompt: next.systemPrompt });
		}
	}

	function addProfile() {
		const id = crypto.randomUUID();
		const newProfile: PersonalityPreset = { id, name: 'Neues Profil', systemPrompt: '' };
		settingsStore.addPersonalityProfile(newProfile);
		// Switch to it and open rename mode
		settingsStore.updatePersonalityProfile(settingsStore.getActiveProfileId(), { systemPrompt: formSystemPrompt });
		settingsStore.setActiveProfileId(id);
		formSystemPrompt = '';
		personaStore.updateCard({ systemPrompt: '' });
		editingProfileId = id;
		editingProfileName = newProfile.name;
	}

	function deleteProfile(id: string) {
		const profiles = settingsStore.getPersonalityProfiles();
		if (profiles.length <= 1) return;
		const isActive = settingsStore.getActiveProfileId() === id;
		settingsStore.removePersonalityProfile(id);
		if (isActive) {
			const remaining = settingsStore.getPersonalityProfiles();
			const next = remaining[0];
			if (next) {
				settingsStore.setActiveProfileId(next.id);
				formSystemPrompt = next.systemPrompt;
				personaStore.updateCard({ systemPrompt: next.systemPrompt });
			}
		}
	}

	function startRename(profile: PersonalityPreset) {
		editingProfileId = profile.id;
		editingProfileName = profile.name;
	}

	function commitRename() {
		if (editingProfileId && editingProfileName.trim()) {
			settingsStore.updatePersonalityProfile(editingProfileId, { name: editingProfileName.trim() });
		}
		editingProfileId = null;
		editingProfileName = '';
	}

	async function handleUpload(file: File) {
		await vrmStore.addModel(file);
		uploadModalOpen = false;
	}

	function updateEmotionExpression(emotion: string, expression: string) {
		vrmStore.setEmotionMapping(emotion, { expression });
	}

	function updateEmotionIntensity(emotion: string, value: number) {
		const intensity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
		vrmStore.setEmotionMapping(emotion, { intensity });
	}

	function updateEmotionFadeIn(emotion: string, value: number) {
		const fadeIn = Number.isFinite(value) ? Math.min(3, Math.max(0.05, value)) : 0.25;
		vrmStore.setEmotionMapping(emotion, { fadeIn });
	}

	function updateEmotionFadeOut(emotion: string, value: number) {
		const fadeOut = Number.isFinite(value) ? Math.min(4, Math.max(0.05, value)) : 0.8;
		vrmStore.setEmotionMapping(emotion, { fadeOut });
	}

	function getEmotionConfig(emotion: string): EmotionMapping {
		const profile = vrmStore.emotionProfile;
		return (
			profile?.[emotion] ?? {
				expression: '',
				intensity: 0.5,
				fadeIn: 0.25,
				fadeOut: 0.8
			}
		);
	}

	function requestModeChange(mode: 'companion' | 'dating_sim') {
		if (mode === appMode) return;
		pendingMode = mode;
		modeConfirmOpen = true;
	}

	function confirmModeChange() {
		if (pendingMode) {
			characterStore.setAppMode(pendingMode);
		}
		modeConfirmOpen = false;
		pendingMode = null;
	}

	function cancelModeChange() {
		modeConfirmOpen = false;
		pendingMode = null;
	}
</script>

<div class="character-screen">
	<!-- Header -->
	<header class="screen-header">
		<input
			type="text"
			class="name-input"
			bind:value={formName}
			placeholder="Character Name"
			onblur={saveName}
		/>
	</header>

	<!-- Main Content -->
	<div class="main-content">
		<!-- Left Panel: Character Preview -->
		<div class="character-panel">
			<!-- App Mode Toggle -->
			<div class="mode-section">
				<span class="section-label">App Mode</span>
				<div class="mode-toggle">
					<button
						class="mode-option"
						class:active={appMode === 'companion'}
						onclick={() => requestModeChange('companion')}
					>
						<Icon name="sparkles" size={14} />
						Companion
					</button>
					<button
						class="mode-option"
						class:active={appMode === 'dating_sim'}
						onclick={() => requestModeChange('dating_sim')}
					>
						<Icon name="heart" size={14} />
						Dating Sim
					</button>
				</div>
			</div>

			<!-- Model Gallery (inline) -->
			<div class="model-gallery">
				<div class="gallery-header">
					<span class="gallery-label">Avatar</span>
					<button class="upload-btn" onclick={() => uploadModalOpen = true}>
						<Icon name="upload" size={14} />
						<span>Add Custom</span>
					</button>
				</div>

				<div class="gallery-grid">
					{#each vrmStore.models as model (model.id)}
						{#if editingModelId === model.id}
							<div class="model-card editing">
								<div class="model-preview">
									{#if model.previewUrl}
										<img src={model.previewUrl} alt={model.name} />
									{:else}
										<Icon name="user" size={24} />
									{/if}
								</div>
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="model-name-input"
									type="text"
									bind:value={editingModelName}
									onblur={commitModelRename}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitModelRename(); }}
									autofocus
								/>
							</div>
						{:else}
							<button
								class="model-card"
								class:active={model.id === vrmStore.activeModelId}
								onclick={() => vrmStore.setActiveModel(model.id)}
								ondblclick={() => startModelRename(model)}
							>
								<div class="model-preview">
									{#if model.previewUrl}
										<img src={model.previewUrl} alt={model.name} />
									{:else}
										<Icon name="user" size={24} />
									{/if}
									{#if model.id === vrmStore.activeModelId}
										<div class="active-check">
											<Icon name="check" size={12} strokeWidth={3} />
										</div>
									{/if}
								</div>
								<span class="model-name">{model.name}</span>
							</button>
						{/if}
					{/each}
				</div>
			</div>

			<div class="personality-section expression-mapping-section">
				<button class="personality-toggle expression-toggle" onclick={() => expressionMappingExpanded = !expressionMappingExpanded}>
					<Icon name="settings" size={16} />
					<span>Expression Mapping (per Avatar)</span>
					<Icon name={expressionMappingExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
				</button>

				{#if expressionMappingExpanded}
					<div class="personality-content expression-content">
						<div class="expression-content-actions">
							<button class="upload-btn" onclick={() => vrmStore.resetEmotionMappingsForActiveModel()}>
								<Icon name="refresh-cw" size={14} />
								<span>Reset Auto</span>
							</button>
						</div>

						{#if vrmStore.availableExpressions.length === 0}
							<p class="expression-empty">
								No expressions detected yet. Select the avatar and wait until it loads in the main scene.
							</p>
						{:else}
							<div class="expression-grid">
								<div class="expression-grid-header">Emotion Tag</div>
								<div class="expression-grid-header">VRM Expression</div>
								<div class="expression-grid-header">Intensity</div>
								<div class="expression-grid-header">Fade In / Out (s)</div>

								{#each emotionTags as emotion}
									{@const cfg = getEmotionConfig(emotion)}
									<div class="expression-emotion">[{emotion}]</div>
									<div>
										<select
											class="expression-select"
											value={cfg.expression}
											onchange={(e) => updateEmotionExpression(emotion, e.currentTarget.value)}
										>
											<option value="">(disabled)</option>
											{#each vrmStore.availableExpressions as expr}
												<option value={expr}>{expr}</option>
											{/each}
										</select>
									</div>
									<div class="expression-intensity">
										<input
											type="range"
											min="0"
											max="1"
											step="0.05"
											value={cfg.intensity}
											oninput={(e) =>
												updateEmotionIntensity(emotion, parseFloat(e.currentTarget.value))}
										/>
										<span>{cfg.intensity.toFixed(2)}</span>
									</div>
									<div class="expression-fades">
										<input
											type="number"
											min="0.05"
											max="3"
											step="0.05"
											value={cfg.fadeIn}
											onchange={(e) => updateEmotionFadeIn(emotion, parseFloat(e.currentTarget.value))}
										/>
										<input
											type="number"
											min="0.05"
											max="4"
											step="0.05"
											value={cfg.fadeOut}
											onchange={(e) => updateEmotionFadeOut(emotion, parseFloat(e.currentTarget.value))}
										/>
									</div>
								{/each}
							</div>
							<p class="expression-hint">
								Mappings are saved per avatar model and loaded automatically when switching models.
							</p>
						{/if}
					</div>
				{/if}
			</div>

				<!-- Core Personality (collapsible) -->
			<div class="personality-section">
				<button class="personality-toggle" onclick={() => personalityExpanded = !personalityExpanded}>
					<Icon name="sparkles" size={16} />
					<span>Core Personality</span>
					<Icon name={personalityExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
				</button>
				{#if personalityExpanded}
					<div class="personality-content">
						<!-- Profile selector bar -->
						<div class="profile-bar">
							<div class="profile-selector">
								{#each personalityProfiles as profile}
									{#if editingProfileId === profile.id}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="profile-name-input"
											type="text"
											bind:value={editingProfileName}
											onblur={commitRename}
											onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitRename(); }}
											autofocus
											/>
									{:else}
										<button
											class="profile-tab"
											class:active={activeProfileId === profile.id}
											onclick={() => switchProfile(profile.id)}
											ondblclick={() => startRename(profile)}
											title="Doppelklick zum Umbenennen"
										>{profile.name}</button>
									{/if}
								{/each}
							</div>
							<div class="profile-actions">
								<button class="profile-btn" onclick={addProfile} title="Neues Profil">
									<Icon name="plus" size={13} />
								</button>
								<button
									class="profile-btn danger"
									onclick={() => activeProfile && deleteProfile(activeProfile.id)}
									title="Profil löschen"
									disabled={personalityProfiles.length <= 1}
								>
									<Icon name="trash" size={13} />
								</button>
							</div>
						</div>

						<textarea
							class="personality-textarea"
							bind:value={formSystemPrompt}
							placeholder="Personality traits, speaking style, background..."
							rows="8"
							onblur={saveSystemPrompt}
						></textarea>

						<!-- Avatar binding per preset -->
						<div class="preset-avatar-row">
							<span class="preset-avatar-label">
								<Icon name="user" size={14} />
								Avatar
							</span>
							<select
								class="preset-avatar-select"
								value={activeProfile?.vrmModelId ?? ''}
								onchange={(e) => {
									const modelId = (e.target as HTMLSelectElement).value || undefined;
									settingsStore.updatePersonalityProfile(activeProfileId, { vrmModelId: modelId });
								}}
							>
								<option value="">— Keep current avatar —</option>
								{#each vrmStore.models as model}
									<option value={model.id}>{model.name}</option>
								{/each}
							</select>
							{#if activeProfile?.vrmModelId}
								<span class="preset-avatar-hint">
									Switches to {vrmStore.models.find(m => m.id === activeProfile.vrmModelId)?.name ?? 'unknown'} when active
								</span>
							{/if}
						</div>
						<!-- Evolution Threshold -->
						<div class="preset-avatar-row">
							<span class="preset-avatar-label">
								<Icon name="sparkles" size={14} />
								Evolution Threshold
							</span>
							<input
								id="ps-evolution-threshold"
								type="number"
								min="1"
								max="100"
								step="1"
								value={characterStore.state.evolutionThreshold}
								onchange={(e) => characterStore.setEvolutionThreshold(Number(e.currentTarget.value))}
								class="preset-avatar-select"
								style="width: 80px; text-align: center;"
							/>
							<span class="preset-avatar-hint">
								Sessions between personality adaptations
							</span>
						</div>
					</div>
				{/if}
			</div>


		</div>

		<!-- Right Panel: Stats -->
		<div class="stats-panel">
			{#if isCharacterLoading}
				<div class="loading-stats">Loading character data...</div>
			{/if}

			{#if isDatingSimMode}
				<!-- Bond Progress (Dating Sim Mode only) - Sims-style glossy bar -->
				<div class="bond-section">
					<div class="bond-progress">
						<div class="bond-header">
							<Tooltip content="Overall affection level. Grows through positive interactions, compliments, and time spent together." side="left">
								<div class="bond-icon">
									<Icon name="heart" size={18} />
								</div>
							</Tooltip>
							<div class="bond-info">
								<span class="bond-tier">{stageInfo.name}</span>
								<span class="bond-description">{stageInfo.description}</span>
							</div>
							<span class="bond-percent">{affectionPercent}%</span>
						</div>
						<div class="bond-bar-track">
							<div class="bond-bar-fill" style="width: {affectionPercent}%">
							</div>
							<div class="bond-bar-markers">
								{#each [25, 50, 75] as marker}
									<div class="bond-marker" style="left: {marker}%"></div>
								{/each}
							</div>
						</div>
					</div>
				</div>

				<!-- Relationship Stats (Dating Sim Mode only) - Sims-style vertical bars -->
				<div class="stats-section">
					<Tooltip content="Core relationship attributes that evolve based on your interactions.">
						<span class="section-label">Relationship Stats</span>
					</Tooltip>
					<div class="sims-stat-bars">
						<Tooltip content="How much she relies on and believes in you. Built through honesty and keeping promises.">
							<div class="sims-stat" style="--bar-color: var(--stat-trust); --bar-glow: rgba(77, 208, 255, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.trust}%">
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="shield" size={14} />
								</div>
								<span class="sims-stat-label">Trust</span>
							</div>
						</Tooltip>
						<Tooltip content="Emotional closeness and vulnerability. Grows from meaningful conversations and shared experiences.">
							<div class="sims-stat" style="--bar-color: var(--stat-intimacy); --bar-glow: rgba(192, 132, 252, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.intimacy}%">
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="heart" size={14} />
								</div>
								<span class="sims-stat-label">Intimacy</span>
							</div>
						</Tooltip>
						<Tooltip content="How at ease she feels around you. Increases with consistent, supportive presence.">
							<div class="sims-stat" style="--bar-color: var(--stat-comfort); --bar-glow: rgba(74, 222, 128, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.comfort}%">
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="home" size={14} />
								</div>
								<span class="sims-stat-label">Comfort</span>
							</div>
						</Tooltip>
						<Tooltip content="How much she admires and values you. Earned through thoughtful actions and integrity.">
							<div class="sims-stat" style="--bar-color: var(--stat-respect); --bar-glow: rgba(96, 165, 250, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.respect}%">
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="award" size={14} />
								</div>
								<span class="sims-stat-label">Respect</span>
							</div>
						</Tooltip>
						<Tooltip content="Her current energy level. Affects mood and responsiveness. Replenishes over time.">
							<div class="sims-stat" style="--bar-color: var(--stat-energy); --bar-glow: rgba(251, 191, 36, 0.5)">
								<div class="sims-bar-track">
									<div class="sims-bar-fill" style="height: {charState.energy}%">
									</div>
								</div>
								<div class="sims-stat-icon">
									<Icon name="zap" size={14} />
								</div>
								<span class="sims-stat-label">Energy</span>
							</div>
						</Tooltip>
					</div>
				</div>
			{:else}
				<!-- Companion Mode: Simplified stats -->
				<div class="companion-mode-section">
					<div class="companion-badge">
						<Icon name="sparkles" size={20} />
						<span>Companion Mode</span>
					</div>
					<p class="companion-description">Relationship stats and events are disabled. Only mood and energy are tracked.</p>
				</div>

				<!-- Energy bar (Companion Mode) - Sims-style -->
				<div class="stats-section companion-energy">
					<span class="section-label">Energy</span>
					<div class="sims-stat-bars single">
						<div class="sims-stat" style="--bar-color: var(--stat-energy); --bar-glow: rgba(251, 191, 36, 0.5)">
							<div class="sims-bar-track tall">
								<div class="sims-bar-fill" style="height: {charState.energy}%">
								</div>
							</div>
							<div class="sims-stat-icon">
								<Icon name="zap" size={16} />
							</div>
							<span class="sims-stat-label">Energy</span>
						</div>
					</div>
				</div>
			{/if}

			<!-- Mood - Sims-style glossy card -->
			<div class="mood-section">
				<Tooltip content="Her emotional state right now, influenced by recent interactions and events.">
					<span class="section-label">Current Mood</span>
				</Tooltip>
				<div class="mood-card" style="--mood-color: {moodInfo.color}">
					<div class="mood-icon-badge">
						<Icon name={moodInfo.icon} size={24} />
					</div>
					<div class="mood-info">
						<span class="mood-name">{moodInfo.description}</span>
						{#if charState.mood.causes.length > 0}
							<span class="mood-cause">{charState.mood.causes[charState.mood.causes.length - 1]}</span>
						{/if}
					</div>
					<div class="mood-indicator">
						<div class="mood-pulse"></div>
					</div>
				</div>
			</div>

			<!-- Activity - Sims-style stat tiles -->
			<div class="activity-section">
				<span class="section-label">Activity</span>
				<div class="activity-grid">
					<div class="activity-tile" style="--tile-color: #ff8f3f; --tile-glow: rgba(255, 143, 63, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="flame" size={16} />
						</div>
						<span class="activity-tile-value">{charState.currentStreak}</span>
						<span class="activity-tile-label">Streak</span>
					</div>
					<div class="activity-tile" style="--tile-color: #fbbf24; --tile-glow: rgba(251, 191, 36, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="trophy" size={16} />
						</div>
						<span class="activity-tile-value">{charState.longestStreak}</span>
						<span class="activity-tile-label">Best</span>
					</div>
					<div class="activity-tile" style="--tile-color: #4dd0ff; --tile-glow: rgba(77, 208, 255, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="message-circle" size={16} />
						</div>
						<span class="activity-tile-value">{charState.totalInteractions}</span>
						<span class="activity-tile-label">Chats</span>
					</div>
					<div class="activity-tile" style="--tile-color: #4ade80; --tile-glow: rgba(74, 222, 128, 0.4)">
						<div class="activity-tile-icon">
							<Icon name="calendar" size={16} />
						</div>
						<span class="activity-tile-value">{charState.daysKnown}</span>
						<span class="activity-tile-label">Days</span>
					</div>
				</div>
			</div>

			<!-- Events (Dating Sim Mode only, collapsible) - Sims-style achievements -->
			{#if isDatingSimMode}
				<div class="events-section">
					<button class="events-toggle" onclick={() => eventsExpanded = !eventsExpanded}>
						<div class="events-toggle-icon">
							<Icon name="star" size={16} />
						</div>
						<span>Achievements</span>
						{#if achievements.length > 0}
							<span class="events-count">{achievements.length}</span>
						{/if}
						<Icon name={eventsExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
					</button>

					{#if eventsExpanded}
						<div class="events-content" transition:slideOpen>
							{#if achievements.length > 0}
								<div class="events-list">
									{#each achievements as achievement, i}
										{@const config = achievementConfig[achievement.type]}
										<div
											class="achievement-card"
											style="--event-color: {config.color}; --event-bg: {config.bgColor}; --delay: {i}"
										>
											<div class="achievement-badge">
												<Icon name={config.icon} size={18} />
											</div>
											<div class="achievement-info">
												<span class="achievement-name">{achievement.name}</span>
												<div class="achievement-meta">
													<span class="achievement-type">{config.label}</span>
													<span class="achievement-date">{formatAchievementDate(achievement.completedAt)}</span>
												</div>
											</div>
											<div class="achievement-check">
												<Icon name="check" size={14} strokeWidth={3} />
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<div class="events-empty">
									<div class="empty-icon">
										<Icon name="sparkles" size={28} />
									</div>
									<span class="empty-title">No achievements yet</span>
									<span class="empty-hint">Keep chatting to unlock special moments!</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Upload Modal -->
	{#if uploadModalOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="upload-modal" onclick={() => uploadModalOpen = false} onkeydown={() => {}}>
			<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
			<div class="upload-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>

				<div class="upload-header">
					<h3>Upload Custom Model</h3>
					<button class="close-btn" onclick={() => uploadModalOpen = false} onkeydown={() => {}}>
						<Icon name="x" size={20} />
					</button>
				</div>
				<VrmUploader onUpload={handleUpload} />
			</div>
		</div>
	{/if}

	<!-- Mode Change Confirmation Modal -->
	{#if modeConfirmOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="confirm-modal" onclick={cancelModeChange} onkeydown={() => {}}>
			<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
			<div class="confirm-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>

				<div class="confirm-icon">
					<Icon name="alert" size={32} />
				</div>
				<h3 class="confirm-title">Switch Mode?</h3>
				<p class="confirm-message">
					Switching modes frequently can lead to unexpected results and disrupt natural progression. Are you sure you want to continue?
				</p>
				<div class="confirm-actions">
					<button class="confirm-btn confirm-btn--cancel" onclick={cancelModeChange} onkeydown={() => {}}>
						Cancel
					</button>
					<button class="confirm-btn confirm-btn--confirm" onclick={confirmModeChange}>
						Switch Mode
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.character-screen {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Header */
	.screen-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-light);
		margin-bottom: 1rem;
		flex-shrink: 0;
	}

	.name-input {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.25rem 0;
		width: auto;
		min-width: 120px;
		max-width: 280px;
		transition: border-color 0.15s ease;
	}

	.name-input:hover {
		border-bottom-color: var(--border-light);
	}

	.name-input:focus {
		outline: none;
		border-bottom-color: var(--accent);
	}

	/* Main Content */
	.main-content {
		flex: 1;
		display: flex;
		gap: 1.5rem;
		min-height: 0;
		overflow: hidden;
	}

	/* Character Panel (Left) */
	.character-panel {
		flex: 1 1 55%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
	}

	.character-panel > * {
		flex-shrink: 0;
	}

	/* Mode Section */
	.mode-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-light);
	}

	.mode-toggle {
		display: flex;
		gap: 0.5rem;
	}

	.mode-option {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	}

	.mode-option:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.mode-option.active {
		background: var(--accent-muted);
		color: var(--accent);
	}

	/* Companion Mode Section */
	.companion-mode-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--accent-subtle);
		border-radius: var(--radius-lg);
	}

	.companion-badge {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--accent);
		border-radius: var(--radius-full);
		color: #fff;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.companion-description {
		margin: 0;
		text-align: center;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	/* Model Gallery */
	.model-gallery {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.gallery-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.gallery-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
	}

	.upload-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.upload-btn:hover {
		background: color-mix(in srgb, var(--bg-tertiary), var(--text-primary) 8%);
		color: var(--text-primary);
	}

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 0.75rem;
	}

	.model-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: background 0.15s ease, box-shadow 0.15s ease;
		box-shadow: var(--shadow-xs);
	}

	.model-card:hover {
		box-shadow: var(--shadow-sm);
	}

	.model-card.active {
		background: var(--accent-muted);
	}

	.model-card.active .model-name {
		color: var(--accent);
	}

	.model-card.active .model-preview {
		background: var(--bg-primary);
		color: var(--accent);
	}

	.model-preview {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
	}

	.model-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.active-check {
		position: absolute;
		top: 0.375rem;
		right: 0.375rem;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: #fff;
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-sm);
	}

	.model-name {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.model-card.editing {
		cursor: default;
		border-color: rgba(1, 178, 255, 0.4);
		box-shadow: 0 0 0 3px rgba(1, 178, 255, 0.15);
	}

	.model-name-input {
		width: 100%;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 0.375rem;
		border: 1px solid rgba(1, 178, 255, 0.4);
		border-radius: 0.375rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		text-align: center;
		outline: none;
	}

	.model-name-input:focus {
		border-color: #01B2FF;
		box-shadow: 0 0 0 2px rgba(1, 178, 255, 0.2);
	}

	.expression-content {
		padding: 0 1rem 1rem;
	}



	.expression-content-actions {
		display: flex;
		justify-content: flex-end;
	}

	.expression-grid {
		display: grid;
		grid-template-columns: 0.9fr 1.4fr 1fr 1fr;
		gap: 0.4rem 0.6rem;
		align-items: center;
	}

	.expression-grid-header {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		padding-bottom: 0.2rem;
		border-bottom: 1px solid var(--border-light);
	}

	.expression-emotion {
		font-family: 'Share Tech Mono', monospace;
		font-size: 0.76rem;
		color: var(--text-secondary);
	}

	.expression-select,
	.expression-fades input {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-light);
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 0.75rem;
	}

	.expression-intensity {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.expression-intensity input[type='range'] {
		flex: 1;
	}

	.expression-intensity span {
		min-width: 2.2rem;
		text-align: right;
		font-size: 0.72rem;
		color: var(--text-tertiary);
		font-family: 'Share Tech Mono', monospace;
	}

	.expression-fades {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}

	.expression-hint,
	.expression-empty {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	/* Personality Section */
	.personality-section {
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: var(--shadow-sm);
	}

	.personality-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.personality-toggle:hover {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.personality-toggle span {
		flex: 1;
		text-align: left;
	}

	.personality-content {
		padding: 0 1rem 1rem;
	}

	.profile-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}

	.profile-selector {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		flex: 1;
	}

	.profile-tab {
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, rgba(0,0,0,0.12));
		background: transparent;
		font-size: 0.72rem;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.profile-tab:hover {
		background: rgba(1, 178, 255, 0.08);
		color: var(--text-primary);
	}

	.profile-tab.active {
		background: #01B2FF;
		color: #fff;
		border-color: #01B2FF;
		font-weight: 600;
	}

	.profile-name-input {
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
		border: 1px solid #01B2FF;
		background: transparent;
		font-size: 0.72rem;
		color: var(--text-primary);
		min-width: 80px;
		outline: none;
	}

	.profile-actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.profile-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 5px;
		border: 1px solid var(--border-color, rgba(0,0,0,0.12));
		background: transparent;
		cursor: pointer;
		color: var(--text-secondary);
		transition: background 0.15s;
	}

	.profile-btn:hover:not(:disabled) {
		background: rgba(1, 178, 255, 0.1);
		color: #01B2FF;
	}

	.profile-btn.danger:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.profile-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.personality-textarea {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid transparent;
		border-radius: var(--radius-lg);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--text-primary);
		resize: vertical;
		transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
	}

	.personality-textarea::placeholder {
		color: var(--text-tertiary);
	}

	.personality-textarea:focus {
		outline: none;
		background: var(--bg-primary);
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-muted);
	}

	/* Stats Panel (Right) */
	.stats-panel {
		flex: 1 1 45%;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
	}

	.stats-panel > * {
		flex-shrink: 0;
	}

	.loading-stats {
		padding: 1.25rem;
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.875rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.section-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	/* Bond Section */
	.bond-section {
		padding: 1.25rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.bond-progress {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.bond-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.bond-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--stat-intimacy);
		border-radius: var(--radius-md);
		color: #fff;
	}

	.bond-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.bond-tier {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.bond-description {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.bond-percent {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--stat-intimacy);
	}

	.bond-bar-track {
		position: relative;
		height: 8px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.bond-bar-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: var(--stat-intimacy);
		border-radius: var(--radius-full);
		transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.bond-bar-markers {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
	}

	.bond-marker {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--border-light);
	}

	/* Stats Section */
	.stats-section {
		padding: 1rem 1.25rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	/* Vertical Stat Bars */
	.sims-stat-bars {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.sims-stat-bars.single {
		justify-content: center;
	}

	.sims-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}

	.sims-bar-track {
		width: 20px;
		height: 80px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-full);
		position: relative;
		overflow: hidden;
	}

	.sims-bar-track.tall {
		height: 100px;
		width: 24px;
	}

	.sims-bar-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--bar-color);
		border-radius: var(--radius-full);
		transition: height 0.5s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.sims-stat-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: var(--bg-secondary);
		border-radius: var(--radius-sm);
		color: var(--bar-color);
	}

	.sims-stat-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-tertiary);
	}

	.companion-energy {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.companion-energy .sims-stat-bars {
		width: 100%;
	}

	/* Mood Section */
	.mood-section {
		padding: 1rem 1.25rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.mood-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
	}

	.mood-icon-badge {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: var(--mood-color);
		border-radius: var(--radius-md);
		color: #fff;
		flex-shrink: 0;
	}

	.mood-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.mood-name {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.mood-cause {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	.mood-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mood-pulse {
		width: 10px;
		height: 10px;
		background: var(--mood-color);
		border-radius: var(--radius-full);
		animation: mood-pulse 2s ease-in-out infinite;
	}

	@keyframes mood-pulse {
		0%, 100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.2);
			opacity: 0.7;
		}
	}

	/* Activity Section */
	.activity-section {
		padding: 1rem 1.25rem;
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.activity-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.625rem;
	}

	.activity-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 0.875rem 0.5rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
	}

	.activity-tile:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-sm);
	}

	.activity-tile-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--tile-color);
		border-radius: var(--radius-sm);
		color: #fff;
	}

	.activity-tile-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.2;
	}

	.activity-tile-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-tertiary);
	}

	/* Events / Achievements Section */
	.events-section {
		background: var(--bg-primary);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: var(--shadow-sm);
	}

	.events-toggle {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 1rem 1.25rem;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.events-toggle:hover {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.events-toggle-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: var(--color-warning);
		border-radius: var(--radius-sm);
		color: #fff;
	}

	.events-toggle span {
		flex: 1;
		text-align: left;
	}

	.events-count {
		font-size: 0.7rem;
		font-weight: 700;
		color: #fff;
		background: var(--accent);
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-full);
	}

	.events-content {
		padding: 0 1rem 1.25rem;
	}

	.events-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.achievement-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
		animation: achievement-slide 0.3s ease-out backwards;
		animation-delay: calc(var(--delay) * 50ms);
	}

	@keyframes achievement-slide {
		from {
			opacity: 0;
			transform: translateX(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.achievement-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-sm);
	}

	.achievement-badge {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background: var(--event-color);
		border-radius: var(--radius-md);
		color: #fff;
		flex-shrink: 0;
	}

	.achievement-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.achievement-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.achievement-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
	}

	.achievement-type {
		color: var(--event-color);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.achievement-date {
		color: var(--text-tertiary);
	}

	.achievement-date::before {
		content: '•';
		margin-right: 0.5rem;
		opacity: 0.5;
	}

	.achievement-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: var(--color-success);
		border-radius: var(--radius-full);
		color: #fff;
		flex-shrink: 0;
	}

	.events-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.625rem;
		padding: 2rem 1rem;
		text-align: center;
	}

	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		color: var(--text-tertiary);
	}

	.empty-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.empty-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}


	.events-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.5rem 1rem;
		color: #01B2FF;
		text-align: center;
		background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
		border: 1px dashed rgba(1, 178, 255, 0.3);
		border-radius: 12px;
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.04);
	}

	:global(.dark) .events-empty {
		background: linear-gradient(180deg, #1a1a1a 0%, #141414 100%);
		border-color: rgba(1, 178, 255, 0.25);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15);
	}

	.events-empty span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}



	/* Upload Modal */
	.upload-modal {
		position: fixed;
		inset: 0;
		background: rgba(28, 43, 51, 0.28);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 2rem;
	}

	.upload-content {
		background: var(--bg-primary);
		border-radius: var(--radius-xl);
		max-width: 400px;
		width: 100%;
		overflow: hidden;
		box-shadow: var(--shadow-xl);
	}

	.upload-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border-light);
	}

	.upload-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		cursor: pointer;
		border-radius: var(--radius-md);
		transition: background 0.15s ease, color 0.15s ease;
	}

	.close-btn:hover {
		background: color-mix(in srgb, var(--bg-tertiary), var(--text-primary) 8%);
		color: var(--text-primary);
	}

	.upload-content :global(.uploader) {
		margin: 1rem;
		aspect-ratio: auto;
		min-height: 200px;
	}

	/* Confirmation Modal */
	.confirm-modal {
		position: fixed;
		inset: 0;
		background: rgba(28, 43, 51, 0.28);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 2rem;
	}

	.confirm-content {
		background: var(--bg-primary);
		border-radius: var(--radius-xl);
		max-width: 360px;
		width: 100%;
		padding: 1.5rem;
		text-align: center;
		box-shadow: var(--shadow-xl);
	}

	.confirm-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		background: var(--accent-subtle);
		border-radius: var(--radius-full);
		color: var(--accent);
		margin-bottom: 1rem;
	}

	.confirm-title {
		margin: 0 0 0.75rem;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.confirm-message {
		margin: 0 0 1.5rem;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
	}

	.confirm-btn {
		flex: 1;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-full);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.confirm-btn--cancel {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}

	.confirm-btn--cancel:hover {
		background: color-mix(in srgb, var(--bg-tertiary), var(--text-primary) 8%);
		color: var(--text-primary);
	}

	.confirm-btn--confirm {
		background: var(--accent);
		color: #fff;
	}

	.confirm-btn--confirm:hover {
		background: var(--accent-hover);
		box-shadow: var(--shadow-glow);
	}

	/* Mobile */
	@media (max-width: 900px) {
		.name-input {
			font-size: 1.25rem;
		}

		.main-content {
			flex-direction: column;
			overflow-y: auto;
		}

		.character-panel {
			flex: none;
		}

		.gallery-grid {
			grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		}

		.expression-grid {
			grid-template-columns: 1fr;
		}

		.expression-grid-header {
			display: none;
		}

		.expression-emotion {
			margin-top: 0.35rem;
			font-weight: 600;
		}

		.stats-panel {
			flex: none;
			overflow: visible;
		}

		.activity-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.gallery-grid {
			grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
			gap: 0.5rem;
		}

		.model-card {
			padding: 0.5rem;
		}

		.model-name {
			font-size: 0.7rem;
		}
	}

	/* Preset avatar binding */
	.preset-avatar-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: rgba(1, 178, 255, 0.04);
		border: 1px solid rgba(1, 178, 255, 0.15);
		border-radius: 0.5rem;
	}

	.preset-avatar-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.preset-avatar-select {
		flex: 1;
		padding: 0.4rem 0.6rem;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 0.375rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
	}

	:global(.dark) .preset-avatar-select {
		border-color: rgba(255, 255, 255, 0.1);
		background: var(--bg-primary);
	}

	.preset-avatar-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}


	@media (max-width: 640px) {
		.preset-avatar-row {
			flex-wrap: wrap;
		}
		.preset-avatar-hint {
			width: 100%;
			padding-left: 1.5rem;
		}
	}
</style>

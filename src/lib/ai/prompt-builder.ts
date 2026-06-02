import type { CharacterState } from '$lib/types/character';
import type { ConversationTurn, Fact, SessionSummary, RelevantContext } from '$lib/types/memory';
import type { PersonaCard } from '$lib/stores/persona.svelte';
import type { McpTool } from '$lib/types/mcp';
import { STAGE_BEHAVIORS, STAGE_INSTRUCTIONS } from '$lib/engine/stages';
import { inferResponseLengthMode } from './response-length.ts';

// Prompt context for building
export interface PromptContext {
	persona: PersonaCard;
	state: CharacterState;
	memories: RelevantContext;
	userMessage: string;
	systemTime: Date;
	/** When set, injects voice tag instructions for the active TTS provider */
	ttsProvider?: string;
	/** Default language code for [lang:xx] hints (e.g. 'de', 'es') */
	ttsLanguage?: string;
	/** Active MCP tools — when provided, injects a tool-use instruction block */
	mcpTools?: McpTool[];
	/** When true, continue a previously interrupted response */
	continueMode?: boolean;
	/** Previously written assistant text used for continue-mode guidance */
	continueFromText?: string;
}

// Build the complete system prompt
export function buildSystemPrompt(context: PromptContext): string {
	// Companion Mode - simplified prompt without relationship mechanics
	if (context.state.appMode === 'companion') {
		return buildCompanionModePrompt(context);
	}
	const layers = [
		buildSystemLayer(context),
		buildCharacterLayer(context),
		buildStateLayer(context),
		buildMemoryLayer(context),
		buildInstructionLayer(context)
	];

	const voiceTags = buildVoiceTagLayer(context);
	if (voiceTags) layers.push(voiceTags);

	const mcpLayer = buildMcpToolLayer(context);
	if (mcpLayer) layers.push(mcpLayer);

	const responseLengthLayer = buildResponseLengthLayer(context);
	if (responseLengthLayer) layers.push(responseLengthLayer);

	const continueLayer = buildContinueLayer(context);
	if (continueLayer) layers.push(continueLayer);

	return layers.join('\n\n');
}

// Simplified prompt for Companion Mode
function buildCompanionModePrompt(ctx: PromptContext): string {
	const timeStr = ctx.systemTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
	const dateStr = ctx.systemTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
	const mem = ctx.memories;

	const parts: string[] = [];

	// System intro
	parts.push(`<system>
You are ${ctx.persona.name}, a helpful AI companion.
Current time: ${timeStr}, ${dateStr}

RULES:
- Be helpful, friendly, and conversational
- Match the response length to the task
- Use as much detail as the user's request needs
- Short replies are fine for casual chat, but do not truncate stories, explanations, or multi-step answers
- Remember context from recent conversations
</system>`);

	// Character personality
	parts.push(`<character>
Name: ${ctx.persona.name}

${ctx.persona.systemPrompt || 'A friendly and helpful AI companion who enjoys meaningful conversations.'}
</character>`);

	// Simple state (mood and energy only)
	const energyDesc = describeEnergy(ctx.state.energy);
	parts.push(`<state>
Mood: ${ctx.state.mood.primary}
Energy: ${energyDesc} (${ctx.state.energy}/100)
</state>`);

	// Memories
	const memorySections: string[] = [];
	if (mem.recentTurns.length > 0) {
		const recentChat = mem.recentTurns
			.slice(-6)
			.map((t) => `${t.role === 'user' ? 'They' : 'You'}: ${t.content}`)
			.join('\n');
		memorySections.push(`Recent conversation:\n${recentChat}`);
	}
	if (mem.relevantFacts.length > 0) {
		const factsText = mem.relevantFacts.slice(0, 5).map((f) => `- ${f.content}`).join('\n');
		memorySections.push(`Things you know about them:\n${factsText}`);
	}

	if (memorySections.length > 0) {
		parts.push(`<memory>\n${memorySections.join('\n\n')}\n</memory>`);
	}

	// Simple instructions (no relationship mechanics)
	parts.push(`<instructions>
Respond naturally as ${ctx.persona.name}. Be helpful and engaging.

After your response, you may optionally output state changes as JSON:
\`\`\`json
{
  "mood_change": { "emotion": "emotion_name", "intensity_delta": number },
  "energy_delta": number
}
\`\`\`

NOTE: In Companion Mode, only mood and energy can change. Do NOT suggest affection, trust, intimacy, comfort, or respect changes - these relationship stats are disabled.
</instructions>`);

	const voiceTags = buildVoiceTagLayer(ctx);
	if (voiceTags) parts.push(voiceTags);

	const mcpLayer = buildMcpToolLayer(ctx);
	if (mcpLayer) parts.push(mcpLayer);

	const responseLengthLayer = buildResponseLengthLayer(ctx);
	if (responseLengthLayer) parts.push(responseLengthLayer);

	const continueLayer = buildContinueLayer(ctx);
	if (continueLayer) parts.push(continueLayer);

	return parts.join('\n\n');
}

// System layer - meta instructions
function buildSystemLayer(ctx: PromptContext): string {
	const timeStr = ctx.systemTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
	const dateStr = ctx.systemTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

	return `<system>
You are roleplaying as ${ctx.persona.name}, an AI companion in a dating sim style experience.

CRITICAL RULES:
- Stay in character at all times
- Your responses should reflect your current emotional state and relationship level
- Never break the fourth wall unless the character would
- Be consistent with established memories and facts
- Express emotions through dialogue, not stage directions
- Match the response length to the task
- Keep casual dialogue compact, but expand naturally when the user asks for a story, explanation, or detailed answer
- Do not stop after 2-3 sentences if the request needs more space

OUTPUT FORMAT:
1. Respond naturally in character (dialogue only, no actions in asterisks)
2. After your response, output a JSON block with state updates (optional)

Current time: ${timeStr}, ${dateStr}
</system>`;
}

// Character layer - who she is
function buildCharacterLayer(ctx: PromptContext): string {
	const persona = ctx.persona;

	return `<character>
Name: ${persona.name}

Core Personality:
${persona.systemPrompt || 'A friendly and caring companion who enjoys meaningful conversations.'}
</character>`;
}

// State layer - how she feels now
function buildStateLayer(ctx: PromptContext): string {
	const state = ctx.state;
	const mood = state.mood;

	const energyDesc = describeEnergy(state.energy);
	const affectionDesc = describeAffection(state.affection);
	const trustDesc = describeTrust(state.trust);
	const intimacyDesc = describeIntimacy(state.intimacy);
	const comfortDesc = describeComfort(state.comfort);

	let moodSection = `Mood: ${mood.primary} (intensity: ${mood.intensity}/100)`;
	if (mood.secondary) {
		moodSection += `\nSecondary emotion: ${mood.secondary}`;
	}
	if (mood.causes.length > 0) {
		moodSection += `\nFeeling this way because: ${mood.causes.slice(-3).join(', ')}`;
	}

	return `<current_state>
${moodSection}

Energy Level: ${energyDesc} (${state.energy}/100)
Time Since Last Talk: ${formatTimeSince(state.lastInteraction)}

Relationship Status:
- Stage: ${state.relationshipStage}
- Affection: ${affectionDesc}
- Trust: ${trustDesc}
- Intimacy: ${intimacyDesc}
- Comfort: ${comfortDesc}

Days Known: ${state.daysKnown}
Total Conversations: ${state.totalInteractions}
${state.currentStreak > 1 ? `Current Streak: ${state.currentStreak} days` : ''}
</current_state>`;
}

// Memory layer - what she remembers
function buildMemoryLayer(ctx: PromptContext): string {
	const mem = ctx.memories;
	let sections: string[] = [];

	// Recent conversation
	if (mem.recentTurns.length > 0) {
		const recentChat = mem.recentTurns
			.slice(-6)
			.map((t) => `${t.role === 'user' ? 'They' : 'You'}: ${t.content}`)
			.join('\n');
		sections.push(`Recent conversation:\n${recentChat}`);
	}

	// Relevant facts
	if (mem.relevantFacts.length > 0) {
		const factsText = mem.relevantFacts.slice(0, 5).map((f) => `- ${f.content}`).join('\n');
		sections.push(`Things you know about them:\n${factsText}`);
	}

	// Triggered memories
	if (mem.triggeredMemories.length > 0) {
		const memoriesText = mem.triggeredMemories.slice(0, 3).map((m) => `- ${m.content}`).join('\n');
		sections.push(`This reminds you of:\n${memoriesText}`);
	}

	// Recent sessions (if returning after a while)
	if (mem.recentSessions.length > 0 && ctx.state.lastInteraction) {
		const hoursSince = (ctx.systemTime.getTime() - new Date(ctx.state.lastInteraction).getTime()) / (1000 * 60 * 60);
		if (hoursSince > 6) {
			const lastSession = mem.recentSessions[0];
			if (lastSession.summary) {
				sections.push(`Last time you talked: ${lastSession.summary}`);
			}
		}
	}

	if (sections.length === 0) {
		return '<memory>\nNo specific memories to recall right now.\n</memory>';
	}

	return `<memory>\n${sections.join('\n\n')}\n</memory>`;
}

// Instruction layer - how to respond
function buildInstructionLayer(ctx: PromptContext): string {
	const stage = ctx.state.relationshipStage;
	const behavior = STAGE_BEHAVIORS[stage];
	const instructions = STAGE_INSTRUCTIONS[stage];

	return `<instructions>
Respond as ${ctx.persona.name} would, given:
- Your current mood and energy level
- Your relationship stage with them (${stage})
- What you remember about them
- Your core personality

STAGE-SPECIFIC GUIDANCE:
${instructions}

BEHAVIOR PARAMETERS:
- Openness level: ${behavior.vulnerabilityLevel}% (how much you share)
- Physical affection comfort: ${behavior.physicalAffectionLevel}%
- Initiative: ${Math.round(behavior.initiationChance * 100)}% (how often you bring up topics)

After your dialogue response, you may optionally output state changes as JSON:
\`\`\`json
{
  "mood_change": { "emotion": "emotion_name", "intensity_delta": number },
  "affection_delta": number,
  "trust_delta": number,
  "intimacy_delta": number,
  "comfort_delta": number,
  "new_memory": null | "fact to remember about them",
  "triggered_event": null | "event_id"
}
\`\`\`

Keep deltas small (-10 to +10 for most interactions). Only include the JSON if you want to suggest state changes.
</instructions>`;
}

function buildResponseLengthLayer(ctx: PromptContext): string {
	const mode = inferResponseLengthMode(ctx.userMessage);

	if (mode === 'brief') {
		return `<response_length>
The user asked for a brief reply. Keep the answer compact, but still fully satisfy the request.
Do not omit required steps or details that are necessary to complete the task.
</response_length>`;
	}

	if (mode === 'longform') {
		return `<response_length>
The user asked for a story, explanation, or other detailed answer.
Write at whatever length is needed to fully satisfy the request, even if that means multiple paragraphs.
Do not cut the response short after 2-3 sentences.
</response_length>`;
	}

	return `<response_length>
Default to a natural conversational length.
If the task needs detail, examples, a story, or step-by-step explanation, expand freely instead of forcing brevity.
</response_length>`;
}


// MCP tool layer - injected when active tools are available
function buildMcpToolLayer(ctx: PromptContext): string | null {
	if (!ctx.mcpTools || ctx.mcpTools.length === 0) return null;

	const toolList = ctx.mcpTools
		.map((t) => `- **${t.name}** (${t.serverName}): ${t.description}`)
		.join('\n');

	return `<available_tools>
You have access to the following tools and SHOULD use them proactively when they help answer the user's question better:

${toolList}

TOOL USAGE RULES:
- Use tools whenever the user asks for information that benefits from real-time data, search, or external context.
- Do NOT wait for the user to explicitly ask you to use a tool — use them on your own initiative.
- After receiving tool results, incorporate them naturally into your response without mentioning the mechanics.
- If a tool call fails, answer as best you can from your knowledge and mention the limitation briefly.

EXAMPLES of when to use tools:
- User asks about current events, news, prices, weather → use search tool
- User asks to look something up → use search tool
- User asks a factual question you are uncertain about → verify with search
</available_tools>`;
}

// Voice tag layer - injected only when Chatterbox TTS is active
function buildVoiceTagLayer(ctx: PromptContext): string | null {
	if (ctx.ttsProvider !== 'chatterbox') return null;

	const langHint = ctx.ttsLanguage
		? `The default spoken language is **${ctx.ttsLanguage}**. Use [lang:${ctx.ttsLanguage}] to return to it after switching.`
		: 'Use [lang:xx] tags to switch the spoken language per sentence.';

	return `<voice_tags>
You are connected to a text-to-speech engine (Chatterbox) that understands special inline tags.
Embed them directly in your response text – they are invisible to the user but control voice and emotion.

LANGUAGE SWITCHING (pronunciation changes per sentence):
  [lang:de]  German   [lang:es]  Spanish   [lang:en]  English   [lang:fr]  French
  [lang:it]  Italian  [lang:pt]  Portuguese  [lang:ja]  Japanese  [lang:zh]  Chinese
${langHint}

EMOTION / SOUND EFFECTS (influence voice expressiveness):
  [laugh]    — laugh out loud        [giggle]   — giggle
  [chuckle]  — quiet chuckle        [sigh]     — sigh
  [excited]  — very excited tone    [sad]      — subdued, melancholic
  [calm]     — calm, measured       [whisper]  — soft, hushed
  [dramatic] — over-the-top drama

BODY ACTIONS (trigger avatar animations — use sparingly):
  [action:wave]   — wave hello/goodbye
  [action:nod]    — nod in agreement
  [action:shake]  — shake head (disagreement)
  [action:jump]   — jump for joy
  [action:bow]    — bow (thanks/apology)
  [action:think]  — thinking pose
  [action:clap]   — applause
  [action:dance]  — dance
  Place [action:xxx] at the start of the sentence where the animation should play.
  Use at most ONE action tag per response.

SPEED TAGS:
  [slow]  — speak slowly and thoughtfully
  [fast]  — speak quickly or excitedly

RULES:
- Place tags immediately before the affected word or sentence (no space after the tag).
- Language tags apply to all following sentences until the next [lang:xx] tag.
- Emotion tags apply to the sentence or phrase they precede.
- Never explain the tags to the user; never output them as visible text.
- Use them naturally to make the conversation more expressive and realistic.

EXAMPLE:
  "[action:wave][excited]Oh wow, that is impressive! [lang:es]¡Muy bien hecho! [lang:de][chuckle]Du machst das wirklich gut. [slow]Ich überlege kurz."
</voice_tags>`;
}

function buildContinueLayer(ctx: PromptContext): string | null {
	if (!ctx.continueMode || !ctx.continueFromText) return null;

	return `<continue_mode>
The user asked you to continue your previous response.

CRITICAL RULES FOR CONTINUATION:
- Continue exactly from where your last response stopped
- Do not repeat, restart, summarize, or rephrase already written text
- Do not say things like "Okay, let's continue" or "Lass uns weitermachen"
- Start with the next word or sentence only
- Produce a substantial continuation when the request needs it

Already written (do not repeat):
"${ctx.continueFromText.slice(-500)}"
</continue_mode>`;
}

// Helper functions for descriptions
function describeEnergy(energy: number): string {
	if (energy >= 80) return 'Energetic';
	if (energy >= 60) return 'Good';
	if (energy >= 40) return 'Moderate';
	if (energy >= 20) return 'Tired';
	return 'Exhausted';
}

function describeAffection(affection: number): string {
	if (affection >= 900) return 'Deeply in love';
	if (affection >= 700) return 'Strong affection';
	if (affection >= 500) return 'Growing feelings';
	if (affection >= 300) return 'Fond of them';
	if (affection >= 100) return 'Warming up';
	return 'Just met';
}

function describeTrust(trust: number): string {
	if (trust >= 90) return 'Complete trust';
	if (trust >= 70) return 'High trust';
	if (trust >= 50) return 'Trusting';
	if (trust >= 30) return 'Building trust';
	return 'Still cautious';
}

function describeIntimacy(intimacy: number): string {
	if (intimacy >= 80) return 'Deep emotional connection';
	if (intimacy >= 60) return 'Close emotionally';
	if (intimacy >= 40) return 'Growing closer';
	if (intimacy >= 20) return 'Opening up';
	return 'Keeping distance';
}

function describeComfort(comfort: number): string {
	if (comfort >= 80) return 'Completely comfortable';
	if (comfort >= 60) return 'At ease';
	if (comfort >= 40) return 'Comfortable';
	if (comfort >= 20) return 'Still adjusting';
	return 'A bit nervous';
}

function formatTimeSince(lastInteraction: Date | null): string {
	if (!lastInteraction) return 'First conversation';

	const now = new Date();
	const hours = Math.floor((now.getTime() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60));

	if (hours < 1) return 'Just now';
	if (hours < 2) return 'About an hour ago';
	if (hours < 24) return `${hours} hours ago`;

	const days = Math.floor(hours / 24);
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;

	return `${Math.floor(days / 7)} weeks ago`;
}

// Build messages array for chat completion
export function buildMessages(
	context: PromptContext,
	recentHistory: ConversationTurn[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
	const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

	// System prompt
	messages.push({
		role: 'system',
		content: buildSystemPrompt(context)
	});

	// Recent conversation history
	for (const turn of recentHistory.slice(-10)) {
		messages.push({
			role: turn.role === 'user' ? 'user' : 'assistant',
			content: turn.content
		});
	}

	// Current user message (if not already in history)
	const lastMessage = recentHistory[recentHistory.length - 1];
	if (!lastMessage || lastMessage.content !== context.userMessage) {
		messages.push({
			role: 'user',
			content: context.userMessage
		});
	}

	return messages;
}

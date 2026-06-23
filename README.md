# Utsuwa (器)

> [!WARNING]
> Utsuwa and The Lab by Ordinary Company have not minted, launched, endorsed, or authorized any cryptocurrency, token, coin, NFT, or blockchain project. We never will. If you see crypto associated with Utsuwa or The Lab, it is a scam. This repository is the only authentic Utsuwa project repository.

<p align="center">
  <img src="static/brand-assets/read-me-banner.png" alt="Utsuwa Banner" />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Utsuwa is an open-source AI companion with 3D VRM avatars.** A platform where you can have a virtual companion that learns and grows with you, bundled with optional mechanics inspired by Japanese [dating sim](https://en.wikipedia.org/wiki/Dating_sim) games. Utsuwa is privacy-focused — your data is stored locally and never leaves your device.

"Utsuwa" means "vessel" in Japanese - a container for AI to inhabit visually.

## Features

- **VRM Model Viewer**: Load and display VRM 3D avatar models with orbit controls and configurable camera position
- **Model-Centric UI**: Full-screen 3D model with unobtrusive overlay controls
- **3D Speech Bubbles**: Chat responses appear as bubbles that track the model's head in 3D space
- **Chat Display Modes**: Choose Bubble, Sidebar, Both, or Off — with configurable typing indicator delay and optional wait tone
- **Chat Interface**: Bottom-centered input bar with streaming responses and sentence-by-sentence TTS delivery
- **Dockable Chat Sidebar**: Collapsible sidebar showing full conversation history alongside the 3D view
- **Voice Input**: Speech-to-text via Groq (Whisper), local Whisper server, or Web Speech API with real-time audio visualization
- **Duplex / VOX Mode**: Hands-free conversation — the companion listens continuously, detects speech automatically using voice activity detection (VAD), transcribes, responds, and returns to listening. Includes noise rejection, background-noise toast notifications, and live sensitivity controls.
- **LLM Integration**: Support for OpenAI, Anthropic, OpenRouter, and any **Custom Endpoint** (Ollama, LM Studio, llama.cpp, LiteLLM, Google Gemini, DeepSeek, xAI, vLLM, or other OpenAI-compatible proxies)
- **Dynamic Model Discovery**: Fetch available models directly from OpenRouter or any OpenAI-compatible custom endpoint, with one-click refresh
- **Text-to-Speech**: Support for ElevenLabs, OpenAI TTS, AllTalk, Chatterbox, and OmniVoice (with per-segment language + expression tags)
- **Provider-Specific TTS Emotions**: Configure emotion tags per TTS provider under **Settings > TTS Emotions**. Each provider has its own emotion table with adjustable speed, pitch, volume, and provider-specific settings (exaggeration for Chatterbox, native sound tags for OmniVoice). Includes body-action mapping rules with probability and cooldown controls, plus live test buttons.
- **Lip-sync**: Audio-driven mouth animation synced to TTS playback
- **Animations**: 18 built-in VRMA motion clips (idle, talking, emotions, actions) with automatic blinking. Upload your own `.vrma` files under **Settings > Animations**. Each animation has an editable description that the LLM sees in its prompt, plus a toggle to enable/disable it for LLM use — so you control which animations the companion can suggest.
- **Character Customization**: Customize your companion's name, personality, and system prompt with saveable presets
- **Companion System**: Multi-axis relationship tracking with mood, events, and semantic memory
- **Semantic Memory**: Local AI-powered memory search using Transformers.js — finds memories by meaning, not just keywords
- **Memory Graph**: Interactive visualization showing how memories connect semantically
- **5-Layer Memory Architecture**: Structured memory system with Base Soul (immutable core), Evolved Persona (learned adaptations), User Model (semantic facts), Episodic Memory (session summaries), and Fact Library (structured knowledge like concepts and exam facts). Vocabulary training is handled by a separate dedicated system.
- **Fact Library**: Type-agnostic structured storage for concepts, exam facts, and general knowledge — automatically managed by the app with confidence-based review scheduling. Browse, search, edit, and review entries via the in-app UI (book icon in top-left). For vocabulary training, use the dedicated Vocabulary System instead.
- **Personality Evolution**: Your companion develops a unique personality over time. After every 10 sessions (configurable), an LLM analyzes your conversation history and suggests subtle communication adaptations — like becoming more playful, more direct, or adjusting to your preferred conversation pace. You review and approve each adaptation before it takes effect. Learned traits persist across sessions and shape every future response.
- **Lazy Session Compaction**: Sessions are automatically summarized via LLM when a new session starts (robust against browser tab closure)
- **Debug Environment**: Real-time logging panel with filterable categories (Prompts, Memory, Sessions, Facts) and live system prompt inspection. Toggle categories in Settings > Developer
- **Scene Backgrounds**: 9 built-in presets (gradients, solid colors, studio grid) plus custom image upload (PNG/JPG/WEBP) and HDRI/EXR environment maps for realistic PBR lighting
- **Data Export/Import**: Download your data as a save file, restore anytime
- **Theming**: Light and dark mode support with system preference detection
- **Scheduled Reminders & Open Tasks**: The companion can set time-based reminders (e.g., "remind me in 5 minutes to check the coffee") using inline `[reminder:5min]...[/reminder]` tags. Reminders are stored locally per session, polled in the background, and when triggered they are injected into the LLM context as a system message so the companion can react. The trigger itself is logged in the debug panel and does not appear in the visible chat history. Non-image reminders are also persisted as semantic facts with `source: open-task` so the companion keeps them in context until resolved. Upcoming reminders and open tasks are shown in a bell dropdown in the chat header, where you can also delete them.
- **Image Search via SearxNG**: The companion can search for images on the web using SearxNG. When the user asks for pictures (e.g., "show me images of cats"), the companion outputs a `[search_image:cats]` tag and images appear in a popup modal. The companion can also close the popup with `[close_images]`. Requires a SearxNG instance (configured via `SEARXNG_URL` environment variable or MCP Tools settings).
- **External Tools via MCP**: Expand your companion's abilities by connecting external tool servers under **Settings > MCP Servers**. For example, she can fetch an image from a URL you share and describe its contents directly, without showing technical details in chat or speech.
- **Vocabulary Training System**: Dedicated vocabulary management separate from the Fact Library. Import vocabulary via CSV upload (drag & drop or paste), then practice with the companion using tag-based retrieval. The companion outputs `[vocab:MODE:FILTER:COUNT]` tags (e.g., `[vocab:category:Begrüßung:10]`, `[vocab:review:5]`, `[vocab:level:A1:20]`) and receives only the requested subset in the next prompt — never all words at once. Familiarity tracking per word. Enable/disable in Settings > Data.
- **Desktop App** *(beta, macOS only)*: Native desktop app with transparent overlay mode — your companion floats on your desktop

### Local-First Storage

All your data is stored locally on your device using IndexedDB:
- No database setup required
- Works offline after initial load
- Export/import save files to back up or transfer your data
- Settings > Data to manage your save files

### Companion System

Build a meaningful relationship with your AI companion through a dating sim-inspired progression system:

- **Multi-axis Relationships**: Track affection, trust, intimacy, comfort, and respect separately
- **8 Relationship Stages**: Progress from Stranger → Acquaintance → Friend → Close Friend → Romantic Interest → Dating → Committed → Soulmate
- **Dynamic Mood**: Real-time emotions with causality tracking (she remembers *why* she feels a certain way)
- **Visual Novel Events**: Milestone moments, romantic scenes, and choices that matter - with custom dialogue and branching responses. Event UI and content are localized (German, English, Spanish, Portuguese, French, Japanese, Chinese) based on your TTS language setting. Milestone and anniversary events can trigger at any time; conditional and random events only fire during the first three turns of a session so they do not interrupt an ongoing conversation.
- **Semantic Memory**: Facts are indexed with vector embeddings for meaning-based retrieval - "outdoor activities" finds memories about hiking. Runs locally using Transformers.js, no API calls
- **Natural Progression**: Hybrid system combining app heuristics + LLM suggestions for believable relationship growth
- **Time-Aware & Session Sense**: Your companion notices when you've been away and reacts accordingly. The system prompt also includes the current session duration and the next scheduled reminder, giving the companion a lightweight sense of elapsed time and upcoming tasks.

See the [Companion System Architecture](https://utsuwa.ai/docs/technology/companion-system) for full details.

### How Memory Works

Utsuwa stores several kinds of memory locally in IndexedDB. They differ in lifetime, structure, and how they get into the LLM prompt:

| Memory type | What it stores | How it gets there | How it reaches the LLM |
|---|---|---|---|
| **Working Memory** | Turns of the current chat session | Automatically as you chat | Injected directly into the prompt (budget scales with model context size) |
| **Semantic Facts** | Free-form facts like „User likes red cars“ | Heuristics or LLM `new_memory` tags | Top semantically relevant facts per message (budget scales with model context size) |
| **Fact Library** | Structured `type/key/value` entries | Manual entry, bulk import, or LLM `structured_fact_seen` tags | Up to 15 semantically relevant entries per message |
| **Session Summaries** | Condensed recap of ended sessions | Lazy compaction when a new session starts | Up to 3 semantically similar summaries per message |
| **Character State** | Mood, relationship stage, stats | Updated every turn | Always in the system prompt |
| **Auto Fact Extraction** | Fallback facts when the main LLM misses memory tags | Slim, separate LLM pass after each response | Stored as Semantic Facts and retrieved like other facts |

**Storage vs. prompt context:**

- Your *storage* can grow large — there is no hard cap on how many facts or sessions you can save.
- Your *prompt context* is deliberately limited. Even with thousands of stored facts, only the most relevant handful are sent to the LLM each turn. This prevents the context window from overflowing.
- The **context size** setting in the LLM configuration (Settings > Modules > Consciousness) controls how many memories, facts, and turns are injected into each prompt. Larger models with bigger context windows get more working memory, facts, session summaries, and fact library entries.
- Semantic search runs locally with Transformers.js embeddings, so finding relevant memories does not cost API tokens.

**Fact deduplication:**

- The free-form **Semantic Facts** table automatically merges duplicate facts. If the same information is extracted again, the existing entry is refreshed (confidence and reference count go up) instead of creating a duplicate.
- The **Fact Library** deduplicates by `type` + `key`. Updating an existing key overwrites the value and increases confidence.

You can inspect all of this in the **Memory Inspector** (database icon in the top-left toolbar).

### Companion Mode vs Dating Sim Mode

Utsuwa offers two relationship modes. You choose during onboarding and can switch later under **Settings > Character > Mode**:

| | **Companion Mode** | **Dating Sim Mode** |
|---|---|---|
| **Relationship progression** | Paused | Active |
| **Stats** | Only **mood** and **energy** change | Affection, trust, intimacy, comfort, respect, mood, and energy all change |
| **Relationship stage** | Locked to `companion` | Progresses through 8 stages: Stranger → Acquaintance → Friend → Close Friend → Romantic Interest → Dating → Committed → Soulmate |
| **Events / milestones** | Disabled | Enabled after each turn |
| **Status UI** | Shows energy + chat count | Shows love, trust, intimacy, comfort, energy, and respect |
| **Prompt** | Simplified companion prompt | Full dating-sim prompt |

**Important:** Companion Mode is *not* emotionless. The companion still has mood, energy, personality, memory, fact library, reminders, image search, animations, and voice — it simply does not advance the romantic relationship. If your persona prompt is affectionate or the companion's mood is warm, it can still feel emotional.

Switching modes preserves your dating-sim stage (it is saved when entering Companion Mode and restored when returning to Dating Sim Mode). Frequent switching is discouraged because it can disrupt natural progression.

### Personality Evolution

Personality Evolution is the mechanism through which Utsuwa develops its own character over time — not through manual configuration, but through actual conversation experience. It is the difference between a statically configured bot and a companion that adapts to you.

**How it works:**

1. **Trigger** — After a configurable number of completed sessions (default: 10), the system triggers an evolution analysis. You can change this threshold under **Settings > Character > Personality > Evolution Threshold**.
2. **Analysis** — An LLM reads the summaries of the recent sessions and looks for communication patterns: Does the user prefer short answers? Do they respond well to humor? Do they like directness?
3. **Suggestions** — The LLM generates up to 2 concrete adaptation suggestions, each with a reason drawn from the sessions.
4. **User confirmation** — A modal appears titled "[CompanionName] has evolved", showing the suggestions. You can select which ones to apply or reject them all.
5. **Application** — Accepted adaptations are stored in `communicationAdaptations[]` (max 5 active entries) and injected into every future system prompt under **Learned communication patterns**:
   ```
   Learned communication patterns:
   - Antworte kürzer wenn der Nutzer kurze Nachrichten schreibt
   - Verwende mehr technische Begriffe wenn es um Programmierung geht
   ```
6. **Reset** — The session counter resets after each evolution and starts counting again.

**Key details:**

- **Active in both modes** — Personality Evolution works in Companion Mode and Dating Sim Mode equally. It is not a dating-sim-exclusive feature.
- **Language-aware** — The generated adaptations are written in the language configured for your TTS provider (e.g., German if you use a German TTS voice).
- **Configurable threshold** — A lower value (2–3) is useful for testing; 10 is the recommended default for normal usage.
- **Rejection is safe** — If you click "Keep Current", no adaptations are saved and the counter continues. The system will suggest again after the next threshold is reached.

### Fact Library

The Fact Library is long-term, structured storage for facts you want the companion to remember reliably. Unlike free-form session summaries, entries are typed, tagged, and retrieved by semantic similarity so the companion can recall them in the right context.

Open it from the **book icon** in the top-left toolbar. There you can browse, search, add, edit, import, and review entries.

**What to store:** anything you want the companion to remember about you, itself, your shared experiences, or topics you discuss repeatedly. Examples:

| Type | Example key / value | Why it helps |
|---|---|---|
| `preference` | Key: `favorite color` → Value: `red` | Companion can avoid suggesting blue things |
| `preference` | Key: `likes` → Value: `hiking, indie games, Thai food` | Plans activities or recommends media |
| `dislike` | Key: `dislikes` → Value: `loud crowds, cilantro` | Avoids unpleasant suggestions |
| `fact` | Key: `job` → Value: `software engineer` | Shapes conversation context |
| `fact` | Key: `pet` → Value: `golden retriever named Mochi` | Asks about Mochi later |
| `goal` | Key: `learning` → Value: `Spanish, A2 level` | Companion can practice vocabulary or cheer progress |
| `shared_experience` | Key: `camping trip 2026` → Value: `rained all night, ate instant ramen` | Creates inside jokes and continuity |
| `rule` | Key: `communication` → Value: `prefer short answers in the morning` | Tunes companion behavior |

**How to add entries:**
1. Click **+ Add** in the Fact Library modal.
2. Fill in **Key** (what the fact is about) and **Value** (the information).
3. Choose a **Type** such as `preference`, `fact`, `dislike`, `goal`, `shared_experience`, or `rule`. Types are free-form strings — use whatever fits your use case.
4. Optionally add a **Category**, **Tags**, and a **Confidence** score (0–1).
5. Save. The entry is embedded locally and retrieved when semantically relevant.

**Import in bulk:** Paste multiple lines and choose a delimiter. For example:
```
favorite color | red
likes | hiking, indie games
pet | golden retriever named Mochi
```
Set delimiter to `|` and type to `preference` (or `fact`) to import all at once.

**Review scheduling:** Entries track `confidence`, `reviewCount`, and `lastReviewedAt`. Lower-confidence facts are reviewed more often. You can manually review entries to increase confidence.

**Note:** For language vocabulary, use the dedicated **Vocabulary Training System** instead. The Fact Library is for general knowledge and persistent user facts.

### Automatically Learned Facts

During conversation the companion can extract and store facts it thinks are important. For example, when you mention that you like red cars, the LLM may emit a memory tag and the app saves it for future reference.

There are two storage destinations, opened from different places in the top-left toolbar:

| Destination | How it is created | Where to view it |
|---|---|---|
| **Semantic Memory (Facts)** | The LLM returns a `new_memory` tag, or the app heuristics detect a fact in your message. | **Memory Graph** (🧠 brain icon). Free-form facts appear as nodes connected by semantic similarity. |
| **Fact Library** | The LLM returns a `structured_fact_seen` JSON block with `type`, `key`, and `value`. | **Fact Library** (📖 book icon). Structured entries with confidence, tags, and review scheduling. |

**Deduplication:**

- Free-form **Semantic Facts** are automatically deduplicated. If the same fact is extracted again, the existing entry is refreshed (its confidence and reference count increase) instead of creating a duplicate.
- **Fact Library** entries are deduplicated by `type` + `key`. Re-saving the same key updates the existing entry.

**Small model fallback:**

If the active LLM does not emit a `new_memory` tag, Utsuwa automatically runs a slim, separate LLM pass after each response. This extractor looks at the last user/assistant exchange and persists any clear, persistent facts as Semantic Facts. It is designed to be cheap enough for small or local models and falls back gracefully if it fails.

**Retroactive Memory Extraction:**

You can manually trigger a scan of the current session at any time. This is useful when:

- You switched from a small model (that ignored memory tags) to a larger one.
- You had a long conversation and want to recover facts the main LLM missed.
- You want a one-shot summary of everything memorable so far.

Open the **Memory Inspector** (database icon in the top-left toolbar) and click **Extract memories**. The LLM analyzes the session transcript, extracts persistent facts, and saves new ones while skipping duplicates.

**Important caveats:**

- Extraction works best when the LLM follows the required memory tags. Small or local models may ignore them.
- The automatic fallback extractor and the retroactive tagger each cost one extra LLM call when triggered.
- You can always add important facts manually in the **Fact Library** if the LLM misses them.
- Use the **Memory Inspector** for a unified view of all learned facts, session summaries, and the current character state.

### Vocabulary Training

A dedicated system for language learning, separate from the general Fact Library:

- **CSV Import**: Upload vocabulary lists via drag & drop or paste. Format:
  ```csv
  sourceWord,targetWord,context,category,level,tags
  Hola,Hola,"¡Hola! ¿Qué tal?",Begrüßung,A1,grußformel
  Casa,Casa,"Mi casa es grande",Wohnen,A1,noun
  Comer,Comer,"Yo como una manzana",Verben,A1,verb
  ```
- **Tag-Based Retrieval**: The companion never sees all vocabulary at once. Instead, it uses tags to request subsets:
  - `[vocab:category:Begrüßung:10]` — 10 words from a category
  - `[vocab:level:A1:20]` — 20 words at a specific level
  - `[vocab:review:5]` — 5 words with lowest familiarity (weakest first)
  - `[vocab:new:10]` — 10 unfamiliar words (familiarity < 0.3)
  - `[vocab:random:15]` — 15 random words
- **Familiarity Tracking**: Each word has a familiarity score (0.0–1.0) that updates as the user practices
- **Prompt-Safe**: Only the requested subset is injected into the prompt (~150 tokens for 20 words), never the full list
- **Enable/Disable**: Toggle vocabulary training in Settings > Data

### Desktop Application (Beta)

A native desktop app built with Tauri that includes all web features plus:

- **Overlay Mode**: Your companion floats on your desktop with a transparent background
- **Always-on-Top**: The overlay stays visible over all other windows
- **Draggable Positioning**: Click and drag the character to reposition anywhere on screen
- **Floating Chat**: Expandable chat input that appears when you click the chat icon
- **Window Switching**: Seamlessly switch between the full app and overlay mode
- **Global Hotkeys**: Push-to-talk, toggle overlay, and focus chat with keyboard shortcuts

The desktop app uses the same codebase as the web version — your save files are compatible between both.

## Supported Providers

### LLM Providers

| Category | Providers |
|----------|-----------|
| **Cloud** | OpenAI, Anthropic, OpenRouter |
| **Custom Endpoint** | Any OpenAI-compatible endpoint: Ollama, LM Studio, llama.cpp, LiteLLM, vLLM, Google Gemini, DeepSeek, xAI, or custom proxies |

Custom Endpoint uses a built-in template selector so common local and cloud OpenAI-compatible services can be chosen with a single click; you can also enter a fully custom base URL. Models are loaded dynamically from the endpoint and cached until you refresh the list.

### TTS Providers (5)

| Category | Providers |
|----------|-----------|
| **Cloud** | ElevenLabs, OpenAI TTS |
| **Local** | AllTalk, Chatterbox, OmniVoice |

#### OmniVoice TTS

OmniVoice is a local diffusion-based TTS engine with 600+ language support and real-time factor ~0.5. Configure it under **Settings > AI Services > Speech TTS**.

- Set the **API base URL** to your local OmniVoice container, for example `http://localhost:8766/`
- Choose **Diffusion steps**: 16 (fast) or 32 (higher quality)
- **Default Voice** profile — two modes:
  - *Synthetic*: design a voice by selecting gender, age group, and pitch
  - *Voice Clone*: select a voice sample loaded from the OmniVoice server
  - Adjust per-voice **speed** (0.25–4.0×)
- **Alternative Voice** profile (enable via checkbox) — same fields as Default, activated by `[voice:alt]` tags in responses
  - When the LLM outputs `[voice:alt]`, OmniVoice switches to the alt profile for that block
  - `[voice:default]` switches back to the main voice
- Language tags `[lang:xx]` are forwarded to OmniVoice so the correct phoneme set is used per segment

OmniVoice passes through the same action and emotion control tags as other providers; see the Chatterbox section for the full tag reference.

#### AllTalk TTS

AllTalk is configured under **Settings > TTS Providers** and connects to your existing AllTalk instance instead of starting a second one.

- Set the **API base URL** to your local AllTalk server, for example `http://localhost:7851/api/`
- Pick a **voice** from the voice dropdown
- Optionally pick an **RVC voice** if your setup provides one
- Leave **Auth token** empty for a normal local install; only fill it in when AllTalk sits behind a proxy or custom auth layer

AllTalk determines the spoken language from the selected voice, so no separate language field is required in Utsuwa.

#### Chatterbox TTS

Chatterbox is configured under **Settings > TTS Providers** and connects to your existing Chatterbox instance (no second service started by Utsuwa).

- Set the **API base URL** to your local Chatterbox server, for example `http://localhost:8300/`
- Pick a **voice** from the dropdown (loaded from the server's predefined voices)
- Optionally tune:
  - **Language** (default language hint)
  - **Exaggeration**
  - **CFG Weight**
  - **Temperature**

Utsuwa supports inline control tags for Chatterbox:

- Language tags: `[lang:de]`, `[lang:es]`, `[lang:en]`, ...
- Emotion/sound tags: `[laugh]`, `[giggle]`, `[chuckle]`, `[sigh]`, `[excited]`, `[sad]`, `[calm]`, `[whisper]`, `[dramatic]`, `[slow]`, `[fast]`
- Body action tags: `[action:wave]`, `[action:nod]`, `[action:shake]`, `[action:jump]`, `[action:bow]`, `[action:think]`, `[action:clap]`, `[action:dance]`

Processing rules:
- Chatterbox mode keeps full language blocks together (only `[lang:xx]` splits), for more natural prosody.
- Other TTS providers keep sentence-by-sentence segmentation.
- If the user asks to continue a previous answer ("weiter", "continue", "go on"), Utsuwa injects continuation guidance so the reply resumes without repeating itself.
- Tags are interpreted for TTS/avatar control but stripped from visible chat output.
- Action tags require matching VRMA files in `/animations/` to play.

### STT Providers (3)

| Category | Providers |
|----------|-----------|
| **Cloud** | Groq (Whisper) |
| **Local** | Whisper (local HTTP server) |
| **Browser** | Web Speech API (no API key required) |

Voice input is accessed via the microphone button in the chat bar. Groq STT uses Whisper for accurate transcription on any platform (including desktop). **Local Whisper** connects to a self-hosted whisper.cpp or faster-whisper server (tested with `deepdml/faster-whisper-large-v3-turbo-ct2` via [speaches](https://github.com/speaches-ai/speaches)) — configure the base URL under **Settings > STT Providers**. Web Speech API works without an API key in Chrome, Edge, and Safari. If a Groq API key is configured, it takes priority automatically.

### Duplex / VOX Mode

Hands-free, continuous conversation without pressing any buttons:

1. Click the **headset icon** (🎧) in the chat bar to enter duplex mode
2. The companion listens for speech using Voice Activity Detection (VAD)
3. When speech is detected, it records, transcribes (via your configured STT provider), generates a response, and speaks it aloud (via your configured TTS provider)
4. It then returns to listening — fully automatic loop
5. Background noise is automatically filtered; a toast notification appears when ambient noise is detected
6. Use the **−/+** buttons next to the headset icon to adjust mic sensitivity in real time (1–10 scale)

Duplex mode requires both an STT provider and a TTS provider to be configured.

**Noise handling**: The VAD calibrates for 3 seconds on startup to measure ambient noise, then uses a 5× noise-floor multiplier so background sounds are far less likely to trigger speech detection. TTS is **only interrupted after transcription confirms real text** — not on raw audio peaks — preventing false interrupts from keyboard clicks, HVAC, or other ambient sounds. If TTS is interrupted mid-response, saying "setze fort" / "continue" / "continuer" / or the equivalent in any of 12 supported languages replays the unspoken tail without a new LLM call.

### Scene Backgrounds

Choose a background for your 3D companion scene under **Settings > Display > Background**:

- **9 built-in presets**: Studio Grid (dot pattern), White, Dark Studio, Blush, Dusk, Midnight, Forest, Aurora
- **Custom Image**: Upload a PNG/JPG/WEBP file via drag & drop or file picker
- **HDRI / EXR**: Enter a `.hdr` or `.exr` URL (e.g. from [Poly Haven](https://polyhaven.com/hdris)) for realistic environment-based lighting — the image illuminates the VRM character with accurate PBR reflections
- Settings are persisted locally and restored on next launch

### Animation System

The companion avatar supports a layered animation system powered by VRMA (VRM Animation) files:

- **18 built-in motion clips**: 7 from the VRoid Motion Pack (Show Full Body, Greeting, Peace Sign, Shoot, Spin, Model Pose, Squat) plus 11 emotion/pose clips (Angry, Blush, Clapping, Goodbye, Jump, Look Around, Relax, Sad, Sleepy, Surprised, Thinking)
- **Idle animations**: 5 clips cycle randomly with smooth crossfades when the avatar is not speaking
- **Talking animation**: Loaded automatically when TTS is active
- **Emote actions**: Triggered via the Developer Tools dropdown or LLM action tags (`[action:wave]`, `[action:jump]`, `[action:clap]`, `[action:think]`, etc.)
- **Custom VRMA upload**: Upload your own `.vrma` files under **Settings > Developer Tools**. After upload you are redirected to **Settings > Animations** where you can manage all animations in a table.
- **Animation Management**: Under **Settings > Animations** every built-in and custom animation is listed in an editable table with:
  - **Active toggle** — enable/disable per animation for LLM visibility
  - **Description** — inline-editable text that the LLM receives in its prompt (e.g. "Wave hello or goodbye")
  - **Type badge** — built-in vs. custom
  - **Delete** — remove custom uploads
- **Emotion-to-Action Mapping**: Emotion tags like `[laugh]`, `[excited]`, or `[sad]` automatically trigger matching body animations without requiring an explicit `[action:xxx]` tag. Each mapping has probability and cooldown controls so the companion feels natural, not mechanical.
- **Memory-safe playback**: Emote actions are automatically disposed after finishing to prevent mixer memory leaks. Idle crossfades clean up old actions after a short delay.
- **VRMA compatibility**: Uploaded files that lack a GLTF scene or contain unsupported morph-target (`weights`) channels are automatically handled by a preprocessor plugin, so most VRMA files from external sources will work.

### Personality Presets

Save and switch between multiple system prompt configurations under **Settings > Character > Personality**:

- A tab-bar above the system prompt textarea lists all saved presets
- **Rename** a preset by double-clicking its tab; **add** with `+`; **delete** with the trash icon
- Two built-in presets ship with Utsuwa:
  - *Standard* — blank template, seeded from your current system prompt on first load
  - *Spanischlehrer* — example dual-voice Spanish teacher preset demonstrating `[voice:default]` / `[voice:alt]` and `[lang:es]` / `[lang:de]` tag usage
- Presets are available during the **onboarding** CharacterStep as one-click chips
- All presets are persisted in localStorage and included in save/export files automatically

### Camera Settings

Under **Settings > Display > Camera**, adjust how the scene is framed:

| Setting | Range | Description |
|---------|-------|-------------|
| **Starting Zoom** | 1.0 – 4.0 | Camera distance from the model (close → far) |
| **Horizontal** | −2.0 – +2.0 | Pan the view left (negative) or right (positive) |
| **Vertical** | −1.5 – +1.5 | Pan the view down (negative) or up (positive) |

Each slider shows its current numeric value so settings can be noted and re-entered precisely. A **Reset Position** button appears whenever Horizontal or Vertical deviates from centre. All values persist across sessions.

### Chat Display Settings

Under **Settings > Display > Chat Display**, control how the companion's responses appear:

| Mode | Behaviour |
|------|-----------|
| **Bubble** | Floating speech bubble next to the companion's head |
| **Sidebar** | Collapsible chat history panel |
| **Both** | Bubble and sidebar simultaneously |
| **Aus** | Text completely hidden; only the typing indicator and voice remain active |

**Typing Indicator Delay** — set how many seconds pass before the animated dots appear after a message is sent (0.0–10.0 s, step 0.1 s). Useful to avoid a distracting flash for short responses.

**Wait tone** — optional soft audio ping (two-tone descending, 400/300 Hz) that plays while the LLM is thinking, starting after the same delay as the typing dots.

### MCP Tool Integration

Connect [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers to give your companion access to external tools such as file access, web search, code execution, database queries, and more.

Configure servers under **Settings > MCP Tools**:

| Transport | How it works |
|-----------|-------------|
| **HTTP / SSE** | Connects to a running MCP server via URL (Streamable HTTP or SSE) |
| **stdio** | Spawns a local process (e.g. `npx -y @modelcontextprotocol/server-filesystem /path`) |

Once a server is enabled, its tools are listed immediately. During chat, if any tools are active, messages are automatically routed through an agentic loop:

1. The LLM receives the tool list in OpenAI function-calling format
2. If it decides to use a tool, the call is executed server-side
3. The result is fed back to the LLM — up to 5 rounds
4. The final answer (and a collapsible summary of tool calls) is streamed back to you

All MCP communication happens server-side through the SvelteKit proxy — no CORS issues, no browser restrictions.
When tools are active, Utsuwa also injects tool-usage guidance into the system prompt so the LLM uses available tools proactively when they improve answer quality.

## Getting Started

> [!NOTE]
> Utsuwa is in its very early development stages. If you're using the app, **save your data often**. Early versions may not have backwards-compatible save states and could require manual reformatting.

### Try it Online

Use Utsuwa directly at **[utsuwa.ai](https://utsuwa.ai)** — no installation required. Or download the macOS desktop app from [GitHub Releases](https://github.com/The-Lab-by-Ordinary-Company/utsuwa/releases).

### Self-Hosting

If you prefer to run Utsuwa locally or host your own instance:

#### Prerequisites

- Node.js 22+
- pnpm (recommended) or npm
- A modern browser (Chrome, Firefox, Safari, Edge) — for the web version

#### Installation

```bash
# Clone the repository
git clone https://github.com/The-Lab-by-Ordinary-Company/utsuwa.git
cd utsuwa

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The app will be available at `http://localhost:5173`

#### Running the Desktop App (Beta)

To run the desktop app from source, you'll need the [Rust toolchain](https://rustup.rs/) in addition to the web prerequisites:

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Run the desktop app
pnpm tauri dev
```

#### Configuration

1. Click the **Settings** (gear icon) in the sidebar
2. Navigate to **Settings > Character** to configure your chat provider:
   - Enable Chat (LLM)
   - Select **OpenAI**, **Anthropic**, or **OpenRouter** and enter your API key, then pick a model
   - Or select **Custom Endpoint** for any OpenAI-compatible service (Ollama, LM Studio, llama.cpp, LiteLLM, vLLM, Google Gemini, DeepSeek, xAI, etc.) — choose a template or enter a base URL, provide an optional API key, and pick or type a model
3. Configure text-to-speech in the same settings area (optional):
   - Select a TTS provider
   - For AllTalk, enter the local API base URL, then choose the voice and optional RVC voice
   - Enter your API key or optional auth token if your setup needs one
   - Configure voice settings

All API keys are stored locally on your device and are never sent to any server except the respective API providers.

#### Custom Endpoint URL Format

Custom Endpoint supports any service that exposes an OpenAI-compatible `/chat/completions` endpoint.

**Ollama**

Enter the **bare host URL** without `/v1`, for example:

- `http://localhost:11434`
- `http://127.0.0.1:11434`

Utsuwa uses that URL to fetch the available model list and automatically adds the OpenAI-compatible `/v1` path for chat requests. If you include `/v1` in the Ollama base URL, model discovery will fail.

The **API key (optional)** field is only needed if you run Ollama behind a proxy or custom auth layer. Leave it empty for a normal local Ollama install.

**llama.cpp / LM Studio / other OpenAI-compatible servers**

Enter the **OpenAI-compatible base URL** for your server, for example:

- `http://localhost:8080/v1` (llama.cpp)
- `http://localhost:1234/v1` (LM Studio)
- `http://localhost:4000` (LiteLLM proxy)

Utsuwa uses that URL directly for model discovery and chat requests. If the server is exposed behind a proxy or auth layer, fill in the **API key (optional)** field; otherwise, leave it empty.

**Context size**

The **context size** slider (1,000–128,000 tokens) controls how much working memory, facts, session summaries, and fact library entries are injected into each prompt. Match it to the context window of the model you are using.

#### Loading a VRM Model

1. Go to **Settings > Avatar**
2. Click **"Load VRM"** to select a local `.vrm` file
3. Or enter a URL to load a VRM model from the web

#### Per-Model Expression Mapping

Different VRM models expose different expression names (for example `Joy/Sorrow/Fun` vs `happy/sad/relaxed`).
Utsuwa provides a per-avatar mapping table under **Settings > Avatar > Expression Mapping**:

- Map each emotion tag (`[laugh]`, `[sad]`, etc.) to a detected VRM expression
- Tune intensity and fade-in/fade-out per emotion
- Use **Reset Auto** to regenerate defaults from detected expressions

Mappings are stored per model and loaded automatically when you switch avatars.

#### Data Management

Your companion data is stored locally on your device. To back up or transfer your data:

1. Go to **Settings > Data**
2. Click **Export Save** to download a JSON file with all your data
3. To restore, click **Import Save** and select your save file
4. Choose **Replace** (wipe and restore) or **Merge** (add to existing)

## Project Structure

```
utsuwa/
├── src/
│   ├── lib/
│   │   ├── ai/             # LLM response parsing and prompt building
│   │   ├── assets/         # Static assets
│   │   ├── components/     # Svelte components
│   │   ├── config/         # App and docs configuration
│   │   ├── data/           # Event definitions and static data
│   │   ├── db/             # IndexedDB database (Dexie)
│   │   ├── engine/         # Companion engine (state, memory, events)
│   │   ├── services/       # LLM, TTS, STT, storage services
│   │   ├── stores/         # Svelte 5 stores (state management)
│   │   ├── styles/         # Shared CSS (prose, etc.)
│   │   ├── types/          # TypeScript types
│   │   └── utils/          # Utility functions
│   ├── content/
│   │   ├── blog/           # Blog post markdown content
│   │   └── docs/           # Documentation site markdown content
│   └── routes/
│       ├── app/            # Main application routes
│       ├── api/            # API routes
│       ├── blog/           # Blog routes
│       ├── docs/           # Documentation site routes
│       └── overlay/        # Desktop overlay route
├── docker/                 # Setup as Docker Container
├── src-tauri/               # Tauri desktop app (Rust)
├── static/
│   └── models/             # Place default VRM models here
└── package.json
```

## Scripts

```bash
pnpm dev          # Start web development server
pnpm build        # Build web app for production
pnpm preview      # Preview production build
pnpm lint         # Type-check the project (svelte-check)
pnpm check        # Same as lint (alias)
pnpm check:watch  # Type-check in watch mode
pnpm tauri dev    # Run the desktop app in development mode
pnpm tauri build  # Build desktop app installer
```

## Roadmap

### Completed

- [x] VRM model loading and display with orbit controls
- [x] 3D speech bubbles tracking model head position
- [x] Multi-provider LLM support (OpenAI, Anthropic, OpenRouter, and any OpenAI-compatible Custom Endpoint)
- [x] Multi-provider TTS support (5 providers: ElevenLabs, OpenAI TTS, AllTalk, Chatterbox, OmniVoice)
- [x] Multi-provider STT support (3 providers: Groq Whisper, local Whisper/speaches server, Web Speech API)
- [x] Audio-driven lip-sync
- [x] Sentence-by-sentence TTS streaming (responses spoken as they arrive, not after full generation)
- [x] VRMA-based animations (idle, talking, blinking)
- [x] 18 built-in VRMA motion clips (VRoid Motion Pack + emotion/pose clips)
- [x] Custom VRMA upload with custom naming and IndexedDB persistence
- [x] Animation mixer memory leak fixes and automatic action disposal
- [x] VRMA preprocessor plugin (scene injection + weights channel filtering for external files)
- [x] Companion system with multi-axis relationships
- [x] 8-stage relationship progression (Stranger → Soulmate)
- [x] Visual novel event system with choices
- [x] Semantic memory system with local embeddings (Transformers.js)
- [x] Time-based mood and relationship decay/recovery
- [x] Local-first IndexedDB storage with export/import
- [x] Theme system with light/dark modes
- [x] Voice input via Groq STT (Whisper) and Web Speech API
- [x] Local Whisper STT server support
- [x] Duplex / VOX mode (hands-free continuous conversation with VAD)
- [x] Dockable chat sidebar (collapsible conversation history panel)
- [x] Scene backgrounds (9 presets + custom image upload + HDR/EXR environment maps)
- [x] Desktop application with transparent overlay mode (macOS only, Windows/Linux planned)
- [x] MCP server integration (HTTP/SSE + stdio transports, agentic tool loop, no CORS restrictions)
- [x] OmniVoice local TTS with dual-voice profiles and 600+ language support
- [x] Personality presets (save/switch/rename system prompts, available during onboarding)
- [x] Chat display modes (Bubble / Sidebar / Both / Off) with typing indicator delay and wait tone
- [x] Duplex noise hold-off and unspoken-segment replay on continue command (12 languages)
- [x] Configurable camera position (horizontal/vertical pan sliders with live numeric readout and reset)
- [x] MCP server edit form (add, edit, delete, enable/disable MCP servers in settings)
- [x] MCP continue-mode support and progressive TTS streaming for tool-augmented responses
- [x] VRM skeleton optimisation updated to combineSkeletons; LookAt proxy pre-registered to suppress library warnings
- [x] **Custom Endpoint provider** — connect any OpenAI-compatible API endpoint (Ollama, LM Studio, llama.cpp, LiteLLM, vLLM, Google Gemini, DeepSeek, xAI, etc.) with template selector, custom base URL, optional API key, dynamic model fetching, and cache refresh
- [x] **Model search in dropdowns** — live text filter in all model selection dropdowns to quickly find models in long lists
- [x] **Duplex VAD robustness** — 3-second calibration, 5× noise-floor multiplier, interrupt only after confirmed transcription (not on audio peaks), clean 1–10 sensitivity scale
- [x] **Developer Expression Overrides** — manual expression values on the Developer page are protected from automatic systems (blink, lip-sync, emotion controller, LookAt)
- [x] **Developer LookAt control** — direct head/eye direction sliders for both VRM 0.x and VRM 1.0 models
- [x] **Developer Emotion Tags** — toggle on/off with visual active state, only one emotion per expression at a time
- [x] **Model persistence fix** — non-local provider models (e.g. openai-compatible) are reloaded from cache on settings page revisit
- [x] **5-Layer Memory Architecture** — Dexie Schema v4 with Base Soul (immutable `soulPrompt`), Evolved Persona (`communicationAdaptations`), User Model (`characterId`-tagged facts), Episodic Memory (lazy session compaction with semantic search), and Fact Library (type-agnostic structured storage with confidence tracking)
- [x] **Structured Fact Extraction** — LLM can emit `structured_fact_seen` to save vocabulary, concepts, or exam facts to the Fact Library; app-managed with auto-confidence updates
- [x] **Personality Evolution** — LLM-powered analysis of session summaries suggests communication adaptations; user confirms per-suggestion before applying; configurable threshold (2–100 sessions); adaptations written in the user's configured language; supports Companion and Dating Sim mode equally
- [x] **Lazy Session Compaction** — Previous open sessions are summarized automatically when a new session starts (handles browser tab closure gracefully); turns are persisted with `sessionId`
- [x] **Episodic Semantic Recall** — Past sessions are retrieved by semantic similarity (cosine on embeddings) rather than just recency; up to 3 thematically matching sessions are injected into the prompt
- [x] **Debug Environment** — Settings > Developer toggles for Prompt / Memory / Session / Fact logging; real-time Debug Panel overlay with category filters, search, and expandable log entries
- [x] **Animation Management** — Settings > Animations table with per-animation Active toggle, inline-editable LLM description, type badge, and custom upload delete
- [x] **Emotion-to-Action Mapping** — Automatic body animation triggers from emotion tags (e.g. `[laugh]` → shoulder shake) with probability and cooldown controls
- [x] **Voice-Tag Layer Sync** — Body action lists in Chatterbox/OmniVoice prompt layers are dynamically generated from available animations, never suggesting missing files
- [x] **VOX Mode AudioContext Fix** — Duplex VAD now resumes AudioContext after creation, fixing transcription failure on fresh sessions
- [x] **TypeScript Zero Errors** — All 13 pre-existing type errors resolved; build now reports 0 errors
- [x] **Svelte Check Zero Warnings** — All 30 pre-existing CSS vendor-prefix, accessibility, and unused-selector warnings resolved; build now reports 0 errors and 0 warnings

### In Progress / Planned

- [x] **LLM-based Session Summaries** — Replace heuristic summaries with real LLM-generated session summaries (2–4 sentences, key topics, emotional arc) for higher-quality episodic recall
- [x] **Fact Library UI** — Settings page to browse, filter, edit, and delete Fact Library entries (vocabulary, concepts, exam facts) with confidence-based sorting

- [ ] **File, Image, and Video Uploads** - Add support for attaching files, images, and videos for multimodal LLM workflows and providers that can use richer context or web-aware tools
- [ ] **Live2D Support** - Alternative to VRM for 2D animated avatars
- [ ] **Windows and Linux Desktop Apps** - Expand desktop builds beyond the current macOS beta

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and contribute to the project.

## Security

For information about security considerations and how to report vulnerabilities, please see our [Security Policy](SECURITY.md).

## Acknowledgments

Utsuwa is built on the shoulders of these excellent projects:

### Inspiration

- **[Airi](https://github.com/moeru-ai/airi)** - The original inspiration for this project. A beautiful AI companion with VRM avatar support.
- **[Amica](https://github.com/semperai/amica)** - Open-source AI companion with VRM support and emotional expressions.
- **[Riko Project](https://github.com/rayenfeng/riko_project)** by [JustRyan](https://www.youtube.com/@JustRayen) - AI waifu project showcasing VRM avatar interactions.

### Core Technologies

- **[@pixiv/three-vrm](https://github.com/pixiv/three-vrm)** - VRM model loading and rendering for Three.js
- **[xsAI](https://github.com/moeru-ai/xsai)** - Unified LLM and TTS provider integration
- **[Three.js](https://github.com/mrdoob/three.js)** - 3D graphics engine
- **[Threlte](https://github.com/threlte/threlte)** - Svelte components for Three.js
- **[SvelteKit](https://github.com/sveltejs/kit)** - Web application framework
- **[Tauri](https://github.com/tauri-apps/tauri)** - Desktop application framework
- **[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)** - Utility-first CSS framework
- **[Transformers.js](https://github.com/xenova/transformers.js)** - In-browser ML for semantic memory embeddings

### UI & Data

- **[bits-ui](https://github.com/huntabyte/bits-ui)** - Headless UI components for Svelte
- **[Dexie.js](https://github.com/dexie/Dexie.js)** - IndexedDB wrapper for local storage
- **[force-graph](https://github.com/vasturiano/force-graph)** - Force-directed graph visualization for memory graph
- **[simple-icons](https://github.com/simple-icons/simple-icons)** - SVG icons for provider logos

### 3D Effects

- **[n8ao](https://github.com/N8python/n8ao)** - Ambient occlusion for Three.js
- **[postprocessing](https://github.com/pmndrs/postprocessing)** - Post-processing effects

## Recent Updates

### Consolidated LLM Provider Architecture
The LLM provider model has been simplified and made more flexible:

- **Four core providers** — OpenAI, Anthropic, OpenRouter, and **Custom Endpoint**.
- **Template selector for Custom Endpoint** — one-click setup for Ollama, LM Studio, llama.cpp, LiteLLM, Google Gemini, DeepSeek, xAI, and fully custom OpenAI-compatible URLs.
- **Dynamic model loading** — OpenRouter and Custom Endpoint fetch their model lists live and cache them; a refresh button reloads the list on demand.
- **Context-size slider** — choose 1,000–128,000 tokens to match your model's context window.
- **Automatic migration** — existing settings from legacy providers (Google, DeepSeek, xAI, Ollama, LM Studio, llama.cpp, OpenAI Compatible) are migrated to Custom Endpoint with the appropriate template and preserved base URL / API key.
- **Unified code path** — Anthropic keeps its native `/messages` flow; every other provider uses a single OpenAI-compatible `/chat/completions` path, reducing duplication and simplifying maintenance.

### Animation Management UI
A new **Settings > Animations** page lists every built-in and custom VRMA animation in an editable table. You can toggle animations on/off for LLM visibility, add inline descriptions that the LLM receives in its prompt, and delete custom uploads. After uploading a `.vrma` file in Developer Tools you are automatically redirected here. The LLM only sees enabled animations — no more suggestions for missing files.

The page now includes a live **VRM viewport** next to the table. Click the ▶ play button on any row to preview the animation on the currently loaded avatar in real time — perfect for writing accurate descriptions and deciding which animations to enable.

### Emotion-to-Action Mapping
Emotion tags like `[laugh]`, `[excited]`, or `[sad]` now automatically trigger matching body animations (e.g. laugh → shoulder shake, excited → jump, sad → sad pose). Each mapping uses probability and cooldown controls so the companion feels natural, not mechanical. Works in both TTS and text-only mode. Explicit `[action:xxx]` tags still take precedence.

### LLM-Based Session Summaries
Session compaction now uses the configured LLM provider to generate rich, contextual summaries including key topics and emotional arcs — replacing the previous heuristic approach. Falls back gracefully if the LLM is unavailable.

### Fact Library UI
A dedicated modal (accessible via the book icon in the top-left corner) allows browsing, searching, filtering, editing, and reviewing Fact Library entries. Entries can be sorted by confidence, date, or review count.

### Personality Evolution — Full Feature Release
Utsuwa now includes a complete personality evolution system that lets your companion grow through real conversation experience:

- **LLM-powered analysis** — After every N sessions (configurable), the configured LLM analyzes session summaries and suggests concrete, reasoned communication adaptations.
- **User confirmation** — A localized modal ("[Name] has evolved") shows each suggestion with its justification. You pick which ones to apply.
- **Language support** — Adaptations are generated in the user's configured TTS language (e.g., German, French, Spanish) so the UI and the learned traits stay consistent.
- **Configurable threshold** — Adjust how often evolution triggers under **Settings > Character > Personality > Evolution Threshold** (default: 10, useful range: 2–100).
- **Persistent impact** — Accepted adaptations are written into the system prompt as *Learned communication patterns* and influence every future response. They are capped at 5 active entries.
- **Works in both modes** — Active in Companion Mode and Dating Sim Mode alike.

### TTS JSON-State Filter
LLM state-update blocks (e.g. `{"mood_change": {"emotion": "happy"}, "trust_delta": 1}`) are now detected even when they span multiple streaming chunks and are never passed to text-to-speech. The streaming speech buffer tracks open/closed curly-brace depth and strips the entire JSON block before it reaches TTS, so you no longer hear raw JSON in the spoken response.

### Dating-Sim Event Localization
Dating-sim event popups are now fully localized:
- **UI labels** (`Continue`, `Finish`, `You said:`, `Click anywhere to continue`) adapt to the configured TTS language.
- **Event content** (intros, dialogue, choices, and responses) supports per-language objects. Romantic and time-based events ship with English and German texts; the structure is open for additional languages.
- Language is derived automatically from the active TTS provider configuration.

### Temporary VRM Preview in Developer Tools
**Settings > Developer Tools** now lets you upload a `.vrm` file for temporary preview. The model loads into the viewport immediately — you can test expressions, animations, and look-at behavior. The uploaded model is **never persisted**; clicking **Restore Original** or leaving the page automatically switches back to the previously active avatar.

### VOX Mode Fix
The duplex VAD service now correctly resumes the AudioContext after creation. Previously, VOX mode appeared active but never transcribed on a fresh browser session because the AudioContext started in `suspended` state. A one-line `audioContext.resume()` fix resolves this.

### TypeScript & Svelte: Zero Errors, Zero Warnings
All 13 pre-existing TypeScript errors and 30 CSS/accessibility warnings have been fixed. The build now reports **0 errors and 0 warnings**.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Star History

<a href="https://www.star-history.com/?repos=The-Lab-by-Ordinary-Company%2Futsuwa&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=The-Lab-by-Ordinary-Company/utsuwa&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=The-Lab-by-Ordinary-Company/utsuwa&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=The-Lab-by-Ordinary-Company/utsuwa&type=date&legend=top-left" />
 </picture>
</a>

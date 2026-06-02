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

- **VRM Model Viewer**: Load and display VRM 3D avatar models with orbit controls
- **Model-Centric UI**: Full-screen 3D model with unobtrusive overlay controls
- **3D Speech Bubbles**: Chat responses appear as bubbles that track the model's head in 3D space
- **Chat Interface**: Bottom-centered input bar with streaming responses and sentence-by-sentence TTS delivery
- **Dockable Chat Sidebar**: Collapsible sidebar showing full conversation history alongside the 3D view
- **Voice Input**: Speech-to-text via Groq (Whisper), local Whisper server, or Web Speech API with real-time audio visualization
- **Duplex / VOX Mode**: Hands-free conversation — the companion listens continuously, detects speech automatically using voice activity detection (VAD), transcribes, responds, and returns to listening. Includes noise rejection, background-noise toast notifications, and live sensitivity controls.
- **LLM Integration**: Support for 9 LLM providers including OpenAI, Anthropic, Google, xAI, DeepSeek, OpenRouter, Ollama, LM Studio, and llama.cpp
- **Local Model Discovery**: Ollama and LM Studio discover installed local models directly from your device
- **Text-to-Speech**: Support for ElevenLabs, OpenAI TTS, AllTalk, and Chatterbox (with per-segment language + expression tags)
- **Lip-sync**: Audio-driven mouth animation synced to TTS playback
- **Animations**: VRMA-based idle and talking animations with automatic blinking
- **Character Customization**: Customize your companion's name, personality, and system prompt
- **Companion System**: Multi-axis relationship tracking with mood, events, and semantic memory
- **Semantic Memory**: Local AI-powered memory search using Transformers.js - finds memories by meaning, not just keywords
- **Memory Graph**: Interactive visualization showing how memories connect semantically
- **Scene Backgrounds**: 9 built-in presets (gradients, solid colors, studio grid) plus custom image upload (PNG/JPG/WEBP) and HDRI/EXR environment maps for realistic PBR lighting
- **Data Export/Import**: Download your data as a save file, restore anytime
- **Theming**: Light and dark mode support with system preference detection
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
- **Visual Novel Events**: Milestone moments, romantic scenes, and choices that matter - with custom dialogue and branching responses
- **Semantic Memory**: Facts are indexed with vector embeddings for meaning-based retrieval - "outdoor activities" finds memories about hiking. Runs locally using Transformers.js, no API calls
- **Natural Progression**: Hybrid system combining app heuristics + LLM suggestions for believable relationship growth
- **Time-Aware**: Your companion notices when you've been away and reacts accordingly

See the [Companion System Architecture](https://utsuwa.ai/docs/technology/companion-system) for full details.

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

### LLM Providers (9)

| Category | Providers |
|----------|-----------|
| **Cloud** | OpenAI, Anthropic, Google Gemini, DeepSeek, xAI (Grok), OpenRouter |
| **Local** | Ollama, LM Studio, llama.cpp |

### TTS Providers (4)

| Category | Providers |
|----------|-----------|
| **Cloud** | ElevenLabs, OpenAI TTS |
| **Local** | AllTalk, Chatterbox |

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
- Emotion/sound tags: `[laugh]`, `[giggle]`, `[chuckle]`, `[sigh]`, `[excited]`, `[sad]`, `[calm]`, `[whisper]`, `[dramatic]`
- Body action tags: `[action:wave]`, `[action:nod]`, `[action:shake]`, `[action:jump]`, `[action:bow]`, `[action:think]`, `[action:clap]`, `[action:dance]`

Processing rules:
- Chatterbox mode keeps full language blocks together (only `[lang:xx]` splits), for more natural prosody.
- Other TTS providers keep sentence-by-sentence segmentation.
- Tags are interpreted for TTS/avatar control but stripped from visible chat output.
- Action tags require matching VRMA files in `/animations/` to play.

### STT Providers (3)

| Category | Providers |
|----------|-----------|
| **Cloud** | Groq (Whisper) |
| **Local** | Whisper (local HTTP server) |
| **Browser** | Web Speech API (no API key required) |

Voice input is accessed via the microphone button in the chat bar. Groq STT uses Whisper for accurate transcription on any platform (including desktop). **Local Whisper** connects to a self-hosted whisper.cpp or faster-whisper server — configure the base URL under **Settings > STT Providers**. Web Speech API works without an API key in Chrome, Edge, and Safari. If a Groq API key is configured, it takes priority automatically.

### Duplex / VOX Mode

Hands-free, continuous conversation without pressing any buttons:

1. Click the **headset icon** (🎧) in the chat bar to enter duplex mode
2. The companion listens for speech using Voice Activity Detection (VAD)
3. When speech is detected, it records, transcribes (via your configured STT provider), generates a response, and speaks it aloud (via your configured TTS provider)
4. It then returns to listening — fully automatic loop
5. Background noise is automatically filtered; a toast notification appears when ambient noise is detected
6. Use the **+/−** buttons next to the headset icon to adjust mic sensitivity in real time

Duplex mode requires both an STT provider and a TTS provider to be configured.

### Scene Backgrounds

Choose a background for your 3D companion scene under **Settings > Display > Background**:

- **9 built-in presets**: Studio Grid (dot pattern), White, Dark Studio, Blush, Dusk, Midnight, Forest, Aurora
- **Custom Image**: Upload a PNG/JPG/WEBP file via drag & drop or file picker
- **HDRI / EXR**: Enter a `.hdr` or `.exr` URL (e.g. from [Poly Haven](https://polyhaven.com/hdris)) for realistic environment-based lighting — the image illuminates the VRM character with accurate PBR reflections
- Settings are persisted locally and restored on next launch

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
   - Select a cloud provider and enter your API key
   - Or select a local server like Ollama, LM Studio, or llama.cpp and choose an installed model
3. Configure text-to-speech in the same settings area (optional):
   - Select a TTS provider
   - For AllTalk, enter the local API base URL, then choose the voice and optional RVC voice
   - Enter your API key or optional auth token if your setup needs one
   - Configure voice settings

All API keys are stored locally on your device and are never sent to any server except the respective API providers.

#### Ollama URL Format

When using Ollama, enter the **bare host URL** without `/v1`, for example:

- `http://localhost:11434`
- `http://127.0.0.1:11434`

Utsuwa uses that URL to fetch the available model list, and it automatically adds the OpenAI-compatible `/v1` path for chat requests. If you include `/v1` in the Ollama base URL, model discovery will fail.

The **Auth token (optional)** field is only needed if you run Ollama behind a proxy or custom auth layer. Leave it empty for a normal local Ollama install.

#### llama.cpp URL Format

When using llama.cpp, enter the **OpenAI-compatible base URL** for your server, for example:

- `http://localhost:8080/v1`
- `http://127.0.0.1:8080/v1`

Utsuwa uses that URL directly for model discovery and chat requests. If your llama.cpp server is exposed behind a proxy or auth layer, you can fill in the **Auth token (optional)** field; otherwise, leave it empty.

#### Loading a VRM Model

1. Go to **Settings > Avatar**
2. Click **"Load VRM"** to select a local `.vrm` file
3. Or enter a URL to load a VRM model from the web

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
- [x] Multi-provider LLM support (8 providers)
- [x] Multi-provider TTS support (3 providers: ElevenLabs, OpenAI TTS, AllTalk)
- [x] Multi-provider STT support (3 providers: Groq Whisper, local Whisper server, Web Speech API)
- [x] Audio-driven lip-sync
- [x] Sentence-by-sentence TTS streaming (responses spoken as they arrive, not after full generation)
- [x] VRMA-based animations (idle, talking, blinking)
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

### In Progress / Planned

- [ ] **File, Image, and Video Uploads** - Add support for attaching files, images, and videos for multimodal LLM workflows and providers that can use richer context or web-aware tools
- [ ] **OpenAI-Compatible Models** - Add a configurable option for OpenAI-compatible model endpoints beyond the currently listed providers
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

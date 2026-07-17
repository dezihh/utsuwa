---
title: Chatterbox-NG TTS Setup
description: Run a local streaming multilingual TTS with voice cloning using the Chatterbox-NG fork.
---

# Chatterbox-NG TTS Setup

[Chatterbox-NG](https://github.com/oasi-systems/chatterbox-ng) is a community fork of Resemble AI's Chatterbox engine. It adds built-in streaming, a 23-language multilingual model, and voice cloning from a few seconds of reference audio. Everything runs locally, so no audio leaves your machine.

## Why Chatterbox-NG?

| Feature | Original Chatterbox | Chatterbox-NG | Cloud TTS (OpenAI/ElevenLabs) |
|---|---|---|---|
| Streaming | Not native | Built-in (~173 ms first chunk) | Provider-specific |
| Multilingual | Limited | 23 languages + normalization | Partial |
| Voice cloning | 5–10 s reference | 5–10 s reference | Limited / paid |
| SSML | Limited | Supported | Limited |
| Endpoint | `/v1/audio/speech` | Proprietary WebSocket `/ws/tts` | Provider-specific |

The main trade-off is that Chatterbox-NG is **not OpenAI-compatible**. Utsuwa therefore ships two small proxy endpoints (`/api/tts/chatterbox/stream` and `/api/tts/chatterbox/voices`) so the browser can talk to it reliably.

## Why the proxy endpoints?

Chatterbox-NG exposes a WebSocket at `/ws/tts`. Browsers cannot reliably open a `ws://localhost` socket from an `https://` page, from a remote client, or on some mobile/Safari combinations. The SvelteKit endpoints:

- open the WebSocket server-side,
- wrap the raw float32 PCM chunks in a streaming WAV header, and
- return ordinary HTTP responses that work from any origin.

You still configure the Chatterbox-NG server's base URL in the UI; Utsuwa routes the request through its own API.

## Requirements

- A machine with enough VRAM for the multilingual model (GPU strongly recommended; CPU is possible but much slower).
- Python 3.10+ with the fork installed.
- Utsuwa desktop app or a self-hosted web build. The public hosted site needs `ALLOW_LOCAL_PROVIDER_HOSTS=true` on the server to reach `localhost` providers.
- Optional but recommended: `espeak-ng` and `pip install phonemizer` for better G2P respelling of foreign words.

## Installation

Chatterbox-NG is installed from source. It needs a Python 3.10+ environment, a CUDA-capable GPU for real-time use (CPU works but is much slower), and several gigabytes of disk space for dependencies and the downloaded model.

```bash
git clone https://github.com/oasi-systems/chatterbox-ng.git
cd chatterbox-ng
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

On first run the model is downloaded automatically; this can take several minutes depending on your connection.

If you prefer Docker, there is no official pre-built image in the upstream repository. You can build your own image from the source tree or use a community image at your own discretion.

Start the server:

```bash
python server_streaming.py --host 0.0.0.0 --port 8765
```

This serves the API at `http://localhost:8765/`.

## Voice cloning

Chatterbox-NG uses reference audio files as voices. Built-in voices live in the installation's `voices/` directory. Cloned voices go in `reference_audio/`.

To add a custom voice:

1. Record or prepare a clean WAV file (5–10 seconds of speech is enough).
2. Copy it into the `reference_audio/` directory inside your installation:
   ```bash
   cp my_voice.wav /path/to/chatterbox-ng/reference_audio/my_voice.wav
   ```
3. Restart the server if it does not pick up the file automatically.
4. In Utsuwa, open **Settings → Text-to-Speech**, select **Chatterbox-NG**, and refresh the voice list. Your clone appears as `ref:my_voice`.

## Connecting Utsuwa

1. Make sure the Chatterbox-NG server is running.
2. In Utsuwa, open **Settings → Text-to-Speech**.
3. Enable **Speech (TTS)** and select **Chatterbox-NG**.
4. The default base URL is `http://localhost:8765/`. Change it only if you run the server on a different port or machine.
5. Click **Refresh** next to the voice field, then pick a voice.
6. (Optional) Adjust **Exaggeration**, **CFG weight**, or **Temperature**. Leave them blank to use the server's defaults.
7. Send a message and your companion speaks.

## Multilingual replies (optional)

Utsuwa supports a lightweight opt-in alternative language. Enable it in **Settings → Text-to-Speech**:

- **Primary language**: the default language (e.g. `en`).
- **Enable alternative language**: turn on a second voice.
- **Alternative language**: the language code that triggers the switch (e.g. `es`).
- **Alternative voice**: the voice to use for that language.

When the model wraps text in `<lang=es>...</lang>` tags, Utsuwa synthesizes those sentences with the alternative voice and language. Untagged text keeps the primary voice.

If your model does not emit the tags on its own, you can ask it to: "When you reply in Spanish, wrap the Spanish part in `<lang=es>` tags."

## Troubleshooting

- **No voices appear after refresh**: check that the server is reachable from the Utsuwa server at the configured base URL. In the desktop app this is the same machine; in a hosted deployment it depends on `ALLOW_LOCAL_PROVIDER_HOSTS`.
- **First generation is slow**: the model is downloaded or warming up. Subsequent requests are faster.
- **Audio stutters**: Chatterbox-NG is a single-GPU diffusion model. Utsuwa caps concurrent synthesis to one request so generations do not queue behind each other.
- **Wrong language spoken**: verify the **Primary language** field and the `<lang=xx>` tags in the model output. Chatterbox-NG uses `language_id`, not free-form language names.

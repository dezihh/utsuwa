---
title: OmniVoice Setup
description: Run OmniVoice locally as a self-hosted TTS engine for Utsuwa.
---

# OmniVoice Setup

[OmniVoice](https://github.com/k2-fsa/OmniVoice) is a local, massively multilingual text-to-speech model. It supports 600+ languages, attribute-based voice design, and zero-shot voice cloning, and it runs entirely on your own hardware.

Utsuwa talks to OmniVoice through a small proxy that exposes an OpenAI-compatible API. The proxy lives in `tools/omnivoice/omnivoice-proxy.py` in the Utsuwa repository and can be run from any directory you like.

## What you get

- **Local inference**: no cloud TTS key, no per-character cost, and no audio leaves your device.
- **GPU acceleration**: on a CUDA GPU, synthesis runs up to 40× faster than real-time, so your companion starts speaking while the reply is still streaming.
- **600+ languages**: the model covers hundreds of languages and dialects; Utsuwa exposes the most common ones in the UI and lets you type any OmniVoice-supported language code.
- **Voice design**: build synthetic voices by gender, age, pitch, dialect, and other attributes.
- **Voice cloning**: create a personal voice from a few seconds of reference audio.
- **Bilingual replies**: pair a primary language + voice with an alternate language + voice; Utsuwa switches automatically sentence by sentence.

## Requirements

- Linux is recommended. OmniVoice can run on CPU, but a CUDA-capable NVIDIA GPU is strongly preferred.
- Docker and Docker Compose (or a compatible container runtime).
- `nvidia-container-toolkit` if you want GPU acceleration inside the container.
- Several gigabytes of free disk space for the downloaded model.
- Internet access on first start to download `k2-fsa/OmniVoice` from HuggingFace.

## Installation

OmniVoice ships as a Docker service in the Utsuwa repository. The image includes Python 3.11, `ffmpeg`, CUDA-capable PyTorch, and the proxy.

```bash
cd /path/to/utsuwa/docker
docker compose up -d omnivoice-proxy
```

The first start downloads the model. Wait until the health endpoint returns `ok`:

```bash
curl http://localhost:8880/health
# {"status":"ok"}
```

### CPU-only mode

If you do not have an NVIDIA GPU or `nvidia-container-toolkit`, remove the `deploy.resources.reservations.devices` block from the `omnivoice-proxy` service in `docker/docker-compose.yaml`, then start the container with `--device cpu`:

```bash
cd /path/to/utsuwa/docker
docker compose run -d --rm --name omnivoice-proxy omnivoice-proxy python omnivoice-proxy.py --host 0.0.0.0 --port 8880 --device cpu --voices-dir /data/voices
```

## Test the setup

With the container running, execute the integration test inside it:

```bash
cd /path/to/utsuwa/docker
docker compose exec omnivoice-proxy python /app/test-omnivoice.py
```

It checks `/health`, lists voices, synthesises a short utterance, and verifies the clone endpoint accepts a request.

## Connect Utsuwa

1. Start the container (`docker compose up -d omnivoice-proxy`).
2. In Utsuwa, open **Settings > TTS**.
3. Enable **Speech** and select **OmniVoice**.
4. Set the base URL to `http://localhost:8880/v1/` (adjust host/port if needed).
5. Choose a **primary language** and a **primary voice**.
6. Optional: enable **Alternative language** and pick an alternate voice. Utsuwa will switch voices sentence by sentence when the model replies in the alternate language.

The desktop app reaches `localhost` directly. If you use the hosted web app, the browser may ask for permission to access local-network devices; allow it. The proxy already sends permissive CORS headers.

## Voice cloning

1. In Utsuwa **Settings > TTS**, switch a voice slot to **Cloned**.
2. Click **Clone New Voice** and upload a short, clean audio clip.
3. Optionally enter the exact text spoken in the clip; this improves quality.
4. The proxy saves the cloned profile to the Docker volume `omnivoice-voices` (mounted at `/data/voices` inside the container) and returns `clone:<id>` to Utsuwa.

You can also clone from the command line:

```bash
curl -X POST http://localhost:8880/v1/voices/clone \
  -F "voice_id=my_voice" \
  -F "ref_audio=@/path/to/sample.wav" \
  -F "ref_text=The quick brown fox jumps over the lazy dog."
```

## Voice consistency

OmniVoice is a diffusion model. When using design attributes alone (gender, age, pitch, accent), each synthesis can produce a different speaker realization — same class, different identity. This is why Utsuwa uses **persistent voice profiles**: the proxy generates a reference audio once per voice design + language, stores it, and reuses it for all future requests. This anchors the speaker identity across sentences and sessions.

### How it works

1. When you select or change a synthetic voice in **Settings > TTS**, Utsuwa asks the proxy to generate a voice profile for your chosen design and language.
2. The profile is saved in the Docker volume `omnivoice-voices` (under `profiles/`) and survives container restarts.
3. Every sentence uses this stored profile as speaker conditioning, regardless of how many sentences the reply contains or how often the language switches.
4. **Changing the voice later automatically creates a new profile** for the new design + language combination. Old profiles are kept and can be deleted manually if you want to free disk space.

### Preview button

The **Preview** button in **Settings > TTS** still works as before. The first preview for a new voice/language combination may take a few seconds because the proxy generates the persistent profile in the background. Subsequent previews and chat messages use the cached profile and are fast.

### Language-specific profiles

Voice clone prompts are language-specific: a prompt generated from German reference audio will produce an accent when speaking Spanish, and vice versa. For a language teacher scenario where native pronunciation matters, Utsuwa creates **one profile per language** automatically. When sentences alternate between German and Spanish, each language uses its own native-sounding profile — both generated from the same design attributes (same gender, age, pitch) but with native pronunciation.

### Cloned voices

**Cloned voices do not need persistent profiles.** They already use your uploaded reference audio as a fixed speaker prompt, so their identity is naturally stable. The profile feature is only for synthetic preset voices built from attributes.

If you clone a voice from a German audio clip, it will sound native in German but carry a German accent in other languages. For native pronunciation in multiple languages, clone separate voices per language (ideally from the same speaker). Alternatively, accept the accent as a natural characteristic.

### Same voice for both language slots (language teacher default)

Set the same voice preset (e.g. "alloy") for both Primary and Alternative voice. Utsuwa will use the correct language-specific profile for each sentence automatically. The speaker identity stays consistent; only the pronunciation rules change.

### Regenerate a profile

Each synthetic voice slot has a **↻ Regenerate profile** button in **Settings > TTS**. Clicking it deletes the stored profile for that exact voice design + language and immediately creates a fresh one.

Use this when:

- A synthetic voice has drifted over many sessions and no longer sounds the way you want.
- You want to explore a slightly different speaker realization of the same design attributes.
- You changed hardware or updated OmniVoice and want a clean profile.

**Important:** the button only affects the profile of the voice slot you click it for. If you have a primary German voice and an alternate Spanish voice, regenerating the alternate voice leaves the primary voice untouched, and vice versa.

Because OmniVoice is a diffusion model, a regenerated profile will be *similar* to the previous one — same gender, age, pitch, and accent — but never a 100% identical copy. Think of it as the same character played by a slightly different actor. Cloned voices are much more stable because they are anchored to your uploaded reference audio.

### Managing profiles

Profiles are identified by a stable key derived from voice, instructions, and language. You can list, delete, or regenerate them via the proxy API.

Generate a profile eagerly (also happens automatically on first use):

```bash
curl -X POST http://localhost:8880/v1/voices/initialize \
  -H "Content-Type: application/json" \
  -d '{"voice":"alloy","instructions":"female, young adult, moderate pitch","language":"de"}'
```

Delete a profile to force regeneration on the next request:

```bash
# Replace <profile_key> with the key returned by /v1/voices/initialize
curl -X DELETE http://localhost:8880/v1/voices/profile/<profile_key>
```

Reset (delete + regenerate) a profile in one call:

```bash
curl -X POST http://localhost:8880/v1/voices/profile/reset \
  -H "Content-Type: application/json" \
  -d '{"voice":"alloy","instructions":"female, young adult, moderate pitch","language":"de"}'
```

To remove all generated profiles, delete the `profiles/` directory inside the `omnivoice-voices` Docker volume.

### Tips

- Use `young adult` or `middle-aged` for clearer output.
- Low temperatures (`position_temperature: 1`, `class_temperature: 0.2`) improve consistency between sentences.
- For clone voices, use a 3–10 second clean reference clip in the target language.

## Proxy options

```
python omnivoice-proxy.py --help
  --host           Bind host (default: 0.0.0.0)
  --port           Bind port (default: 8880)
  --device         cpu | cuda | auto (default: cpu)
  --model-id       HuggingFace model id (default: k2-fsa/OmniVoice)
  --max-concurrent Max parallel synthesis requests (default: 1)
  --voices-dir     Directory for cloned voice profiles
```

Keep `--max-concurrent 1` on a single GPU. OmniVoice is a diffusion model; parallel synthesis on one GPU usually increases total latency rather than throughput.

## Troubleshooting

### CUDA out of memory

Close other GPU applications or run the proxy with `--device cpu`. CPU inference is much slower but needs no VRAM.

### Utsuwa cannot reach the proxy

- Confirm the proxy is running: `curl http://localhost:8880/health`.
- If Utsuwa is in the browser on a different machine, use the desktop app instead. The hosted web app cannot reach plain `http://` servers on another host.
- On the hosted web app reaching `localhost`, allow the browser's local-network permission prompt.

### Cloned voice sounds off

Use a short, clean clip with minimal background noise. The proxy normalises audio automatically, but the source quality is the biggest factor.

## See also

- [OmniVoice repository](https://github.com/k2-fsa/OmniVoice)
- [Local TTS Setup](./local-tts-setup) for Kokoro-FastAPI and openedai-speech

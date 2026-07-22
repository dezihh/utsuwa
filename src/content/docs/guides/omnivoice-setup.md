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

OmniVoice builds synthetic voices from attribute descriptions (gender, age, pitch, accent). Because it is a diffusion model, the resulting timbre can vary slightly from one synthesis to the next, even with identical settings. Short phrases and extreme temperature values (e.g. `position_temperature: 0`, `class_temperature: 0`) tend to make these variations more noticeable.

**Cloned voices are usually more stable.** A clone is anchored to a concrete reference recording, so successive sentences keep a more consistent speaker identity. If you want the most stable bilingual experience, consider cloning one voice for your primary language and another for your alternate language instead of relying purely on synthetic presets.

Practical tips:
- Use `young adult` or `middle-aged` rather than `child` for clearer, louder output.
- Try non-zero temperatures (`position_temperature: 1`, `class_temperature: 1`) if short phrases sound noisy or inconsistent.
- For clone voices, use a clean, noise-free reference clip that matches the language you will synthesise most often.

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

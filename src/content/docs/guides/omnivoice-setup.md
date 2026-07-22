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
- Python **3.11**. OmniVoice 0.2.1 depends on older `numba`/`llvmlite` builds that do not yet support Python 3.12+.
- `ffmpeg` installed system-wide (used for audio normalisation during voice cloning).
- Several gigabytes of free disk space for the downloaded model.
- Internet access on first start to download `k2-fsa/OmniVoice` from HuggingFace.

## Installation

The examples below install OmniVoice into a dedicated directory next to the Utsuwa repository, but you can use any path.

### Option A: using `uv` (recommended)

[uv](https://docs.astral.sh/uv/) can fetch the correct Python version and manage the virtual environment in one step.

```bash
mkdir -p /path/to/omnivoice-env
cd /path/to/omnivoice-env

# 1. Create a Python 3.11 virtual environment
uv venv --python 3.11

# 2. Install dependencies from the Utsuwa tools directory
uv pip install -r /path/to/utsuwa/tools/omnivoice/requirements.txt
```

### Option B: using plain `venv`

If you already have Python 3.11 available:

```bash
mkdir -p /path/to/omnivoice-env
cd /path/to/omnivoice-env

python3.11 -m venv .venv
source .venv/bin/activate

pip install -r /path/to/utsuwa/tools/omnivoice/requirements.txt
```

## Start the proxy

```bash
cd /path/to/omnivoice-env
source .venv/bin/activate

# GPU
python /path/to/utsuwa/tools/omnivoice/omnivoice-proxy.py --device cuda --port 8880

# CPU-only
python /path/to/utsuwa/tools/omnivoice/omnivoice-proxy.py --device cpu --port 8880
```

The first start downloads the model. Wait until you see:

```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8880
```

Verify readiness:

```bash
curl http://localhost:8880/health
# {"status":"ok"}
```

## Test the setup

With the proxy running, run the integration test:

```bash
cd /path/to/omnivoice-env
source .venv/bin/activate
python /path/to/utsuwa/tools/omnivoice/test-omnivoice.py
```

It checks `/health`, lists voices, synthesises a short utterance, and verifies the clone endpoint accepts a request.

## Connect Utsuwa

1. Start the proxy.
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
4. The proxy saves the cloned profile to `~/.omnivoice-proxy/voices/<id>.pt` and returns `clone:<id>` to Utsuwa.

You can also clone from the command line:

```bash
curl -X POST http://localhost:8880/v1/voices/clone \
  -F "voice_id=my_voice" \
  -F "ref_audio=@/path/to/sample.wav" \
  -F "ref_text=The quick brown fox jumps over the lazy dog."
```

## Proxy options

```
python /path/to/utsuwa/tools/omnivoice/omnivoice-proxy.py --help
  --host           Bind host (default: 0.0.0.0)
  --port           Bind port (default: 8880)
  --device         cpu | cuda | auto (default: cpu)
  --model-id       HuggingFace model id (default: k2-fsa/OmniVoice)
  --max-concurrent Max parallel synthesis requests (default: 1)
  --voices-dir     Directory for cloned voice profiles
```

Keep `--max-concurrent 1` on a single GPU. OmniVoice is a diffusion model; parallel synthesis on one GPU usually increases total latency rather than throughput.

## Troubleshooting

### Build error for `llvmlite`

You are likely using Python 3.12+. Recreate the environment with Python 3.11:

```bash
rm -rf .venv
uv venv --python 3.11
uv pip install torch==2.6.0 torchaudio==2.6.0 \
  fastapi "uvicorn[standard]" requests soundfile "omnivoice>=0.2.1"
```

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

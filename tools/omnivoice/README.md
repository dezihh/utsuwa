# OmniVoice Proxy

This directory contains the native [OmniVoice](https://github.com/k2-fsa/OmniVoice) integration for [Utsuwa](https://github.com/The-Lab-by-Ordinary-Company/utsuwa):

- `omnivoice-proxy.py` — small OpenAI-compatible FastAPI proxy that wraps OmniVoice.
- `test-omnivoice.py` — integration test for the proxy endpoints.
- `requirements.txt` — Python dependencies.

The proxy exposes the endpoints Utsuwa expects (`/v1/audio/speech`, `/v1/voices`, `/v1/voices/clone`, `/health`) and adds CORS headers so the hosted web app and the desktop app can talk to it.

## What you get

- A local, GPU-accelerated text-to-speech engine.
- 600+ supported languages and dialects.
- Synthetic voice design (gender, age, pitch, dialect, …).
- Zero-shot voice cloning from a short audio clip.
- Bilingual replies with independent primary/alternate voices (used by Utsuwa).
- No cloud API key required.

## Requirements

- Linux with NVIDIA GPU recommended (CUDA 12 capable driver).
- For CPU-only inference a modern multi-core CPU is required; synthesis will be noticeably slower.
- Python **3.11** is strongly recommended. OmniVoice 0.2.1 pulls older `numba`/`llvmlite` builds that currently do not support Python 3.12+.
- `ffmpeg` installed system-wide (used by the proxy for audio normalisation during cloning).
- Internet access for the first start to download the `k2-fsa/OmniVoice` model from HuggingFace.

## Installation

You can install the dependencies directly from this directory. The examples below create a virtual environment next to the repository, but any path works.

### Using `uv` (recommended)

[uv](https://docs.astral.sh/uv/) handles the Python version and the virtual environment for you.

```bash
mkdir -p /path/to/omnivoice-env
cd /path/to/omnivoice-env

# 1. Create a Python 3.11 virtual environment
uv venv --python 3.11

# 2. Install dependencies
uv pip install -r /path/to/utsuwa/tools/omnivoice/requirements.txt
```

### Using plain `venv`

If you already have Python 3.11 installed:

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

On first start the OmniVoice model is downloaded from HuggingFace. This needs several gigabytes of disk space and may take a few minutes depending on your connection. Wait until you see:

```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8880
```

Verify it is ready:

```bash
curl http://localhost:8880/health
# {"status":"ok"}
```

## Test the proxy

A small integration test is included. Start the proxy in one terminal, then run:

```bash
cd /path/to/omnivoice-env
source .venv/bin/activate
python /path/to/utsuwa/tools/omnivoice/test-omnivoice.py
```

It checks `/health`, `/v1/voices`, synthesises a short clip, and verifies that cloning accepts a request.

## Connect Utsuwa

1. Start the proxy (`python /path/to/utsuwa/tools/omnivoice/omnivoice-proxy.py --device cuda --port 8880`).
2. Open Utsuwa and go to **Settings > TTS**.
3. Enable **Speech** and select **OmniVoice**.
4. Leave the base URL as `http://localhost:8880/v1/` (or adjust the host/port if the proxy runs elsewhere).
5. Choose a **primary language** and voice (Synthetic or Cloned), and optionally enable an **alternate language** with its own voice.

The desktop app talks to `localhost` directly. If you use the hosted web app (`https://app.utsuwa.ai`), the browser may ask for permission to access local-network devices; allow it. The proxy already sends permissive CORS headers.

## Voice cloning

1. Open Utsuwa **Settings > TTS**.
2. Choose **Cloned** for a voice slot and click **Clone New Voice**.
3. Pick a short, clear audio clip (a few seconds of clean speech) and optionally enter the spoken text.
4. The proxy stores the cloned voice profile under `~/.omnivoice-proxy/voices/<id>.pt` (or the directory passed with `--voices-dir`).

You can also clone via curl:

```bash
curl -X POST http://localhost:8880/v1/voices/clone \
  -F "voice_id=my_voice" \
  -F "ref_audio=@/path/to/sample.wav" \
  -F "ref_text=The quick brown fox jumps over the lazy dog."
```

## Proxy command-line options

```
python /path/to/utsuwa/tools/omnivoice/omnivoice-proxy.py --help
  --host           Bind host (default: 0.0.0.0)
  --port           Bind port (default: 8880)
  --device         cpu | cuda | auto (default: cpu)
  --model-id       HuggingFace model id (default: k2-fsa/OmniVoice)
  --max-concurrent Max parallel synthesis requests (default: 1)
  --voices-dir     Directory for cloned voice profiles
```

Keep `--max-concurrent 1` for a single-GPU setup. OmniVoice is a diffusion model; running more than one synthesis in parallel on one GPU usually increases total latency rather than throughput.

## Troubleshooting

### `llvmlite` build error during install

You are probably using Python 3.12 or newer. Recreate the environment with Python 3.11:

```bash
rm -rf .venv
uv venv --python 3.11
uv pip install -r /path/to/utsuwa/tools/omnivoice/requirements.txt
```

### `RuntimeError: CUDA out of memory`

OmniVoice needs several gigabytes of VRAM. Close other GPU applications, or run with `--device cpu` for CPU inference.

### Proxy starts but Utsuwa cannot reach it

- Check the firewall / port: `curl http://localhost:8880/health` must return `{"status":"ok"}` from the same machine.
- If Utsuwa runs in the browser on a different machine, the hosted site cannot reach `http://` servers on another host due to mixed-content rules. Use the desktop app, or run Utsuwa and the proxy on the same machine.
- On the hosted site reaching `localhost`, allow the browser's local-network permission prompt.

### Cloned voice sounds wrong

Use a clean, short clip with little background noise. The proxy normalises the audio, but a good source sample is still the biggest quality factor.

## See also

- Full Utsuwa guide: [OmniVoice Setup](https://docs.utsuwa.ai/docs/guides/omnivoice-setup)
- [OmniVoice repository](https://github.com/k2-fsa/OmniVoice)

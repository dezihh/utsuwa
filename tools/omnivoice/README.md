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
- Docker and Docker Compose (or a compatible container runtime).
- `nvidia-container-toolkit` if you want GPU acceleration inside the container.
- Internet access for the first start to download the `k2-fsa/OmniVoice` model from HuggingFace.

## Installation

OmniVoice runs inside a Docker container defined in the Utsuwa repository. The container image includes Python 3.11, `ffmpeg`, CUDA-capable PyTorch, and the OmniVoice proxy.

### 1. Clone or locate the Utsuwa repository

```bash
cd /path/to/utsuwa
```

### 2. Build and start the container

```bash
cd docker
docker compose up -d omnivoice-proxy
```

On first start the OmniVoice model is downloaded from HuggingFace. This needs several gigabytes of disk space and may take a few minutes depending on your connection. Wait until the health endpoint returns `ok`:

```bash
curl http://localhost:8880/health
# {"status":"ok"}
```

### CPU-only mode

If you do not have an NVIDIA GPU or `nvidia-container-toolkit`, edit `docker/docker-compose.yaml` and remove the `deploy.resources.reservations.devices` block under `omnivoice-proxy`. Then start the container with `--device cpu` by changing the `CMD` in `docker/Dockerfile.omnivoice-proxy` or by overriding the command:

```bash
cd docker
docker compose run -d --rm --name omnivoice-proxy omnivoice-proxy python omnivoice-proxy.py --host 0.0.0.0 --port 8880 --device cpu --voices-dir /data/voices
```

## Test the proxy

A small integration test is included. Start the container (see above), then run the test inside the container:

```bash
cd docker
docker compose exec omnivoice-proxy python /app/test-omnivoice.py
```

It checks `/health`, `/v1/voices`, synthesises a short clip, and verifies that cloning accepts a request.

## Connect Utsuwa

1. Start the container (`docker compose up -d omnivoice-proxy` from the `docker` directory).
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

## Persistent voice profiles (synthetic voices)

Synthetic preset voices are built from attributes (gender, age, pitch, accent). Because OmniVoice is a diffusion model, each request can produce a slightly different speaker realization. To keep the voice consistent across sentences, the proxy generates a reference audio on first use, creates a `VoiceClonePrompt` from it, and stores it under `~/.omnivoice-proxy/voices/profiles/`.

- One profile is created per **voice + instructions + language** combination.
- Switching voices or languages creates additional profiles automatically.
- Cloned voices do not use this mechanism; they are already anchored to your reference audio.

Eagerly generate a profile (also happens automatically on first synthesis):

```bash
curl -X POST http://localhost:8880/v1/voices/initialize \
  -H "Content-Type: application/json" \
  -d '{"voice":"alloy","instructions":"female, young adult, moderate pitch","language":"de"}'
```

Delete a profile to force regeneration:

```bash
curl -X DELETE http://localhost:8880/v1/voices/profile/<profile_key>
```

## Proxy command-line options

```
python omnivoice-proxy.py --help
  --host          Bind host (default: 0.0.0.0)
  --port          Bind port (default: 8880)
  --device        cpu | cuda | auto (default: cpu)
  --model-id      HuggingFace model id (default: k2-fsa/OmniVoice)
  --max-concurrent Max parallel synthesis requests (default: 1)
  --voices-dir    Directory for cloned voice profiles
```

Keep `--max-concurrent 1` for a single-GPU setup. OmniVoice is a diffusion model; running more than one synthesis in parallel on one GPU usually increases total latency rather than throughput.

## Troubleshooting

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

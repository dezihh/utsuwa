# Tools

This directory contains helper scripts, small standalone services, and installation guides that support Utsuwa but are not part of the core application build.

## OmniVoice

The [`omnivoice/`](./omnivoice) subdirectory contains everything needed to run [OmniVoice](https://github.com/k2-fsa/OmniVoice) as a local text-to-speech backend for Utsuwa:

- `omnivoice-proxy.py` — OpenAI-compatible FastAPI proxy that wraps OmniVoice and adds CORS headers for browser use.
- `test-omnivoice.py` — Integration test that checks `/health`, `/v1/voices`, TTS synthesis, and voice cloning.
- `requirements.txt` — Python dependencies for the proxy.
- `README.md` — Step-by-step setup guide for a native Python-venv installation.

See [`omnivoice/README.md`](./omnivoice/README.md) for installation and usage instructions, or the [OmniVoice Setup guide](https://docs.utsuwa.ai/docs/guides/omnivoice-setup) in the docs for the full Utsuwa integration.

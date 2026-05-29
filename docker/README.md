# Docker setup

This directory contains the Docker entrypoint for the Utsuwa app only.
It does **not** start Ollama, TTS, or STT again — those are expected to run in the parent stack.

## What this compose does

- Runs the Utsuwa web app in a container
- Uses host networking so the app server can reach local services on `localhost`
- Exposes the app on port `5173`

## Prerequisites

- Node.js dependencies are installed through the container
- The local AI services are already running elsewhere:
  - Ollama: `http://127.0.0.1:11434/v1`
  - Local TTS bridge: `http://127.0.0.1:8200/v1`
  - STT endpoint: use the port from your parent stack

## Start

```bash
cd docker
docker compose up
```

Then open the app on `http://localhost:5173`.

## Notes

- Keep the app settings on server-reachable local URLs, not browser-only ones.
- If you later add a reverse proxy, this compose can stay focused on the app container.

# Docker setup

This directory contains the Docker entrypoint for the Utsuwa app only. It does **not** start Ollama, TTS, or STT — those are expected to run in the parent stack and Utsuwa connects to them via URLs you configure in the app.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile.prod` | Multi-stage production build. |
| `docker-compose.example.yaml` | Shared template. Copy this to `docker-compose.yaml` and adjust it for your setup. |
| `docker-compose.override.yml` | Optional local-only tweaks. Created automatically by Docker Compose and ignored by git. |

## Quick start

```bash
cd docker
cp docker-compose.example.yaml docker-compose.yaml
# edit docker-compose.yaml if you want to change defaults
docker compose up
```

The `utsuwa-dev` container mounts the repository root and runs `pnpm dev`. It uses `network_mode: host` so the app can reach local services on `localhost`. The app is available at `http://localhost:5173`.

## Environment variables

See the main `README.md` → **Self-Hosting → Docker** for a full explanation of the available environment variables.

The most common ones to change locally are:

- `UTSUWA_PROFILE_SYNC_ENABLED` — enable cloud profile backup/restore via PIN.
- `UTSUWA_MCP_ENABLED` — enable MCP tool use (server-side).
- `UTSUWA_DATA_DIR` — where server-side profile backups are stored.
- `ALLOW_LOCAL_PROVIDER_HOSTS` — allow the browser to reach `localhost`/private providers.

Put local-only tweaks in `docker-compose.override.yml` so the example file stays generic.

## Notes

- Keep the app settings on server-reachable local URLs, not browser-only ones.
- If you later add a reverse proxy, this compose can stay focused on the app container.
- Custom `.vrma` animation files may be copyrighted. Only the default clips (`VRMA_0*.vrma`, `idle*.vrma`, `talking.vrma`) are kept in the repository; place your own clips in `static/animations/` locally.

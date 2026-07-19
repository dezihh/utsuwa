#!/usr/bin/env python3
"""
omni-proxy — Minimal OpenAI-compatible HTTP wrapper for k2-fsa/OmniVoice.

Start:
  pip install omnivoice fastapi uvicorn
  python tools/omnivoice-proxy.py --port 8880

Endpoints:
  POST /v1/audio/speech         — TTS with voice/instructions
  POST /v1/voices/clone         — Voice cloning (multipart)
  GET  /v1/voices               — List presets + clones
  DELETE /v1/voices/clone/<id>  — Delete a cloned voice
  GET  /v1/models               — ["omnivoice"]
  GET  /health                  — 200 when ready, 503 during startup
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from omnivoice import OmniVoice, VoiceClonePrompt

logger = logging.getLogger("omnivoice-proxy")

PRESETS: list[dict[str, str]] = [
    {"id": "alloy", "description": "female, young adult, moderate pitch, american accent"},
    {"id": "ash", "description": "male, young adult, low pitch, american accent"},
    {"id": "ballad", "description": "male, middle-aged, low pitch, british accent"},
    {"id": "cedar", "description": "male, middle-aged, low pitch, american accent"},
    {"id": "coral", "description": "female, young adult, high pitch, australian accent"},
    {"id": "echo", "description": "male, middle-aged, moderate pitch, canadian accent"},
    {"id": "fable", "description": "female, middle-aged, moderate pitch, british accent"},
    {"id": "marin", "description": "female, middle-aged, moderate pitch, canadian accent"},
    {"id": "nova", "description": "female, young adult, high pitch, american accent"},
    {"id": "onyx", "description": "male, middle-aged, very low pitch, british accent"},
    {"id": "sage", "description": "female, elderly, low pitch, british accent"},
    {"id": "shimmer", "description": "female, young adult, very high pitch, american accent"},
    {"id": "verse", "description": "male, young adult, moderate pitch, british accent"},
]

_PRESET_MAP: dict[str, str] = {p["id"]: p["description"] for p in PRESETS}

_model: OmniVoice | None = None
_semaphore: asyncio.Semaphore | None = None
_voices_dir: Path | None = None


def _get_voice_dir() -> Path:
    return _voices_dir or Path.home() / ".omnivoice-proxy" / "voices"


def _list_clones() -> list[str]:
    d = _get_voice_dir()
    if not d.exists():
        return []
    return sorted(p.stem for p in d.glob("*.pt"))


async def _generate(
    text: str,
    *,
    voice: str = "",
    instructions: str = "",
    speed: float = 1.0,
    num_step: int | None = None,
    position_temperature: float | None = None,
    class_temperature: float | None = None,
) -> bytes:
    """Run OmniVoice TTS and return WAV bytes (24 kHz, float32)."""
    import io

    import numpy as np
    import soundfile as sf

    loop = asyncio.get_running_loop()
    assert _model is not None
    assert _semaphore is not None

    async with _semaphore:
        kw: dict[str, Any] = {}
        if speed != 1.0:
            kw["speed"] = speed
        if num_step is not None:
            kw["num_step"] = num_step
        if position_temperature is not None:
            kw["position_temperature"] = position_temperature
        if class_temperature is not None:
            kw["class_temperature"] = class_temperature

        if voice.startswith("clone:"):
            clone_id = voice.replace("clone:", "", 1)
            prompt_file = _get_voice_dir() / f"{clone_id}.pt"
            if not prompt_file.exists():
                raise HTTPException(status_code=404, detail=f"Clone '{clone_id}' not found")
            prompt = await loop.run_in_executor(None, VoiceClonePrompt.load, str(prompt_file))
            kw["voice_clone_prompt"] = prompt
        elif instructions:
            kw["instruct"] = instructions
        elif voice in _PRESET_MAP:
            kw["instruct"] = _PRESET_MAP[voice]

        audio = await loop.run_in_executor(None, lambda: _model.generate(text, **kw))

    buf = io.BytesIO()
    sf.write(buf, audio[0], 24000, format="WAV", subtype="FLOAT")
    return buf.getvalue()


_app_started = False


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _app_started, _model, _semaphore
    import torch

    cfg = app.state.cfg
    logger.info("Loading OmniVoice model (%s) on %s ...", cfg.model_id, cfg.device)
    _model = OmniVoice.from_pretrained(
        cfg.model_id,
        device_map=cfg.device,
        dtype=torch.float16,
        load_asr=False,
    )
    _semaphore = asyncio.Semaphore(cfg.max_concurrent)
    _app_started = True
    logger.info("Ready.")
    yield
    _app_started = False
    _model = None
    _semaphore = None


app = FastAPI(title="omnivoice-proxy", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    if _app_started:
        return {"status": "ok"}
    raise HTTPException(status_code=503, detail="Model is loading")


@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [{"id": "omnivoice", "object": "model"}]}


@app.get("/v1/voices")
async def list_voices():
    clones = _list_clones()
    return {
        "presets": PRESETS,
        "clones": [{"id": f"clone:{c}", "name": c} for c in clones],
    }


@app.post("/v1/voices/clone")
async def clone_voice(
    ref_audio: UploadFile = File(...),
    voice_id: str = Form(...),
    ref_text: str = Form(""),
):
    if not voice_id or not voice_id.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="voice_id must be alphanumeric (dashes/underscores allowed)")

    import tempfile

    loop = asyncio.get_running_loop()
    _get_voice_dir().mkdir(parents=True, exist_ok=True)

    suffix = Path(ref_audio.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await ref_audio.read())
        tmp_path = tmp.name

    try:
        prompt = await loop.run_in_executor(
            None,
            lambda: _model.create_voice_clone_prompt(ref_audio=tmp_path, ref_text=ref_text or None),
        )
        out_path = _get_voice_dir() / f"{voice_id}.pt"
        await loop.run_in_executor(None, prompt.save, str(out_path))
    finally:
        os.unlink(tmp_path)

    return {"id": f"clone:{voice_id}"}


@app.delete("/v1/voices/clone/{clone_id}")
async def delete_clone(clone_id: str):
    path = _get_voice_dir() / f"{clone_id}.pt"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Clone '{clone_id}' not found")
    path.unlink()
    return {"deleted": clone_id}


@app.post("/v1/audio/speech")
async def speech(request: Request):
    body = await request.json()
    text = body.get("input", "")
    if not text:
        raise HTTPException(status_code=400, detail="'input' is required")

    voice = body.get("voice", "")
    instructions = body.get("instructions", "")
    speed = float(body.get("speed", 1.0))
    num_step = body.get("num_step")
    position_temperature = body.get("position_temperature")
    class_temperature = body.get("class_temperature")

    wav = await _generate(
        text,
        voice=voice,
        instructions=instructions,
        speed=speed,
        num_step=int(num_step) if num_step is not None else None,
        position_temperature=float(position_temperature) if position_temperature is not None else None,
        class_temperature=float(class_temperature) if class_temperature is not None else None,
    )
    return Response(content=wav, media_type="audio/wav")


def _parse_args():
    p = argparse.ArgumentParser(description="omnivoice-proxy")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8880)
    p.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    p.add_argument("--model-id", default="k2-fsa/OmniVoice")
    p.add_argument("--max-concurrent", type=int, default=1, help="Max concurrent synthesis requests")
    p.add_argument("--voices-dir", default=None, help="Directory for cloned voice profiles")
    return p.parse_args()


def main():
    args = _parse_args()

    global _voices_dir
    if args.voices_dir:
        _voices_dir = Path(args.voices_dir)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    # Attach config to app state so lifespan can access it.
    app.state.cfg = args

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
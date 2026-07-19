#!/usr/bin/env python3
"""
Test client for omnivoice-proxy — verifies all endpoints work.

Usage:
  # Start proxy in another terminal first:
  #   python tools/omnivoice-proxy.py --device cpu
  #
  # Then run:
  python tools/test-omnivoice.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

BASE = "http://localhost:8880"


def die(msg: str):
    print(f"  FAIL: {msg}")
    sys.exit(1)


def check(name: str, ok: bool, detail: str = ""):
    status = "OK" if ok else "FAIL"
    print(f"  [{status}] {name}")
    if not ok and detail:
        print(f"         {detail}")
    if not ok:
        sys.exit(1)


def main():
    print("OmniVoice Proxy — Integration Test\n")

    # 1. Health
    print("1. Health check")
    try:
        r = requests.get(f"{BASE}/health", timeout=5)
    except requests.ConnectionError:
        die("Proxy not running. Start it first: python tools/omnivoice-proxy.py")
        return  # unreachable, makes type checker happy
    check("GET /health → 200", r.status_code == 200)
    health = r.json()
    check("status is 'ok'", health.get("status") == "ok")

    # 2. Models
    print("\n2. Models")
    r = requests.get(f"{BASE}/v1/models")
    check("GET /v1/models → 200", r.status_code == 200)
    models = r.json()
    check("contains 'omnivoice'", any(m["id"] == "omnivoice" for m in models.get("data", [])))

    # 3. Voices
    print("\n3. Voices")
    r = requests.get(f"{BASE}/v1/voices")
    check("GET /v1/voices → 200", r.status_code == 200)
    voices = r.json()
    check("has presets", len(voices.get("presets", [])) > 0)
    print(f"         Found {len(voices['presets'])} presets, {len(voices.get('clones', []))} clones")

    # 4. Basic TTS
    print("\n4. TTS (voice preset)")
    r = requests.post(
        f"{BASE}/v1/audio/speech",
        json={"model": "omnivoice", "input": "Hello world.", "voice": "alloy"},
    )
    check("POST /v1/audio/speech → 200", r.status_code == 200, f"HTTP {r.status_code}")
    check("returns audio/wav", r.headers.get("content-type", "").startswith("audio"))
    wav_path = Path("/tmp/omnivoice-test-preset.wav")
    wav_path.write_bytes(r.content)
    print(f"         Saved to {wav_path}")

    # 5. TTS with instructions
    print("\n5. TTS (voice design)")
    r = requests.post(
        f"{BASE}/v1/audio/speech",
        json={
            "model": "omnivoice",
            "input": "This is a test of voice design.",
            "instructions": "female, british accent, high pitch",
        },
    )
    check("POST /v1/audio/speech (instructions) → 200", r.status_code == 200, f"HTTP {r.status_code}")
    wav_path = Path("/tmp/omnivoice-test-design.wav")
    wav_path.write_bytes(r.content)
    print(f"         Saved to {wav_path}")

    # 6. Voice cloning
    print("\n6. Voice cloning")
    # Use the preset TTS output as reference audio
    ref_audio = Path("/tmp/omnivoice-test-preset.wav")
    if not ref_audio.exists():
        print("  SKIP: no reference audio available (run test 4 first)")
    else:
        r = requests.post(
            f"{BASE}/v1/voices/clone",
            data={"voice_id": "test_clone"},
            files={"ref_audio": ref_audio.open("rb")},
        )
        check("POST /v1/voices/clone → 200", r.status_code == 200, f"HTTP {r.status_code}")
        result = r.json()
        check("returns clone ID", result.get("id") == "clone:test_clone")

        # Verify clone appears in voices list
        r2 = requests.get(f"{BASE}/v1/voices")
        clones = r2.json().get("clones", [])
        check("clone appears in voice list", any(c["id"] == "clone:test_clone" for c in clones))

        # TTS with clone
        r3 = requests.post(
            f"{BASE}/v1/audio/speech",
            json={"model": "omnivoice", "input": "This is my cloned voice.", "voice": "clone:test_clone"},
        )
        check("POST /v1/audio/speech (clone) → 200", r3.status_code == 200, f"HTTP {r3.status_code}")
        wav_path = Path("/tmp/omnivoice-test-clone.wav")
        wav_path.write_bytes(r3.content)
        print(f"         Saved to {wav_path}")

        # Cleanup: delete clone
        r4 = requests.delete(f"{BASE}/v1/voices/clone/test_clone")
        check("DELETE /v1/voices/clone/test_clone → 200", r4.status_code == 200)

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
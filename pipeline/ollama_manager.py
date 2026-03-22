"""
Ollama server lifecycle management.

Handles starting / stopping the local Ollama server, model availability
checks, and graceful cleanup via atexit.
"""

import atexit
import os
import subprocess
import time

import ollama as ollama_lib
import requests

from pipeline.config import OLLAMA_URL, OLLAMA_MODEL


# Module-level state — tracks whether *this* process started Ollama
_ollama_process = None
_started_by_script = False


def is_ollama_running() -> bool:
    """Return True if the Ollama HTTP server responds."""
    try:
        requests.get(OLLAMA_URL, timeout=3)
        return True
    except Exception:
        return False


def start_ollama() -> subprocess.Popen | None:
    """
    Launch Ollama if it isn't already running.

    Returns the Popen handle when we start it ourselves, or None if it was
    already alive.
    """
    global _started_by_script

    if is_ollama_running():
        print("⚡ Ollama already running")
        return None

    print("🚀 Starting Ollama...")
    process = subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={
            **os.environ,
            "OLLAMA_METAL": "1",
            "OLLAMA_MAX_LOADED_MODELS": "1",
            "OLLAMA_NUM_PARALLEL": "1",
        },
    )
    _started_by_script = True

    # Wait up to 15 s for the server to become healthy
    for _ in range(30):
        if is_ollama_running():
            print("✅ Ollama ready")
            return process
        time.sleep(0.5)

    raise RuntimeError("❌ Ollama failed to start within 15 seconds")


def stop_ollama(process: subprocess.Popen | None) -> None:
    """Terminate Ollama only if *we* started it."""
    if process and _started_by_script:
        print("🛑 Stopping Ollama...")
        process.terminate()


def ensure_model(model: str | None = None) -> None:
    """Pull the model if it's not already available locally."""
    model = model or OLLAMA_MODEL
    try:
        ollama_lib.show(model)
    except Exception:
        print(f"⬇️ Pulling model {model}...")
        subprocess.run(["ollama", "pull", model], check=True)


def setup_ollama() -> None:
    """
    One-call bootstrap: start Ollama, ensure model exists, register cleanup.

    Safe to call multiple times — only the first invocation has side effects.
    """
    global _ollama_process

    if _ollama_process is not None:
        return  # already set up

    _ollama_process = start_ollama()
    ensure_model()
    atexit.register(lambda: stop_ollama(_ollama_process))

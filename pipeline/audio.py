"""
Audio generation with Kokoro TTS.

Synthesises narration audio from clean TTS lines and writes a WAV file
alongside a metadata JSON sidecar.
"""

import json
import os
import random
import time

import numpy as np
import soundfile as sf
from kokoro import KPipeline

from pipeline.config import KOKORO_VOICES


def generate_audio(
    tts_lines: list[dict],
    dir_path: str,
    voice: str | None = None,
    speed: float = 1.0,
    lang_code: str = "a",
) -> tuple[str, str]:
    """
    Generate narration audio from TTS lines using Kokoro.

    Parameters
    ----------
    tts_lines : list[dict]
        Output of :func:`pipeline.tts_formatter.format_for_tts`.
    dir_path : str
        Directory to write output files into.
    voice : str | None
        Kokoro voice ID.  Random choice from config if ``None``.
    speed : float
        Playback speed multiplier.
    lang_code : str
        Kokoro language code (``"a"`` = American English).

    Returns
    -------
    tuple[str, str]
        ``(audio_path, voice_used)``
    """
    if voice is None:
        voice = random.choice(KOKORO_VOICES)

    print(f"\n🔊 Step 4: Generating audio with Kokoro...")
    print(f"   Voice: {voice}")

    pipeline = KPipeline(lang_code=lang_code)

    # Join clean lines into one text block
    full_text = "\n".join(line["text_clean"] for line in tts_lines)

    start = time.time()
    audio_chunks: list[np.ndarray] = []
    for _, _, audio in pipeline(full_text, voice=voice, speed=speed, split_pattern=r'\n+'):
        audio_chunks.append(audio)

    full_audio = np.concatenate(audio_chunks)
    elapsed = time.time() - start

    out_path = os.path.join(dir_path, "04_narration.wav")
    sf.write(out_path, full_audio, 24000)

    duration = len(full_audio) / 24000
    print(f"   Duration: {int(duration // 60)}:{int(duration % 60):02d}")
    print(f"   Generated in {elapsed:.1f}s")

    # Persist metadata sidecar
    meta = {
        "voice": voice,
        "duration_seconds": round(duration, 1),
        "generation_time_seconds": round(elapsed, 1),
        "sample_rate": 24000,
    }
    with open(os.path.join(dir_path, "04_audio_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return out_path, voice

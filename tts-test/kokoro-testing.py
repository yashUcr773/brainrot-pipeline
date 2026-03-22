#!/usr/bin/env python3
"""
Kokoro Voice Audition
======================
Generates the same dramatic text with different Kokoro voices
so you can pick the best narrator for TikTok storytelling.

Setup:
    pip install kokoro soundfile numpy
    brew install espeak-ng    # macOS
    # apt-get install espeak-ng  # Linux

Usage:
    python kokoro_voices.py
"""

import os
import time
import numpy as np
import soundfile as sf
from kokoro import KPipeline

OUTPUT_DIR = "./voice_audition"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Short punchy sample — tests how each voice handles dramatic TikTok narration
SAMPLE_TEXT = """There was a white van in my backyard. And my dad's best friend just told me to get inside.
Let me explain.
I was walking home from school, sweating like crazy, when Uncle George pulled up in his car.
Uncle George drove me around to the back, and that's when I saw it. The van.
He told me to wait.
My parents weren't home, and I heard noises coming from inside the house.
My hands were literally shaking.
Four men. Inside my house. Stealing everything.
He saved my life. And he'll never even know it."""

# ── Voices to test ───────────────────────────────────────────────
# af_ = American female, am_ = American male
# bf_ = British female, bm_ = British male
VOICES = {
    # American female voices
    "af_heart":   "American Female — Heart (warm, natural)",
    "af_bella":   "American Female — Bella (clear, expressive)",
    "af_sarah":   "American Female — Sarah (friendly)",
    "af_nicole":  "American Female — Nicole (smooth)",
    "af_nova":    "American Female — Nova (energetic)",
    "af_sky":     "American Female — Sky (bright)",
    "af_jessica": "American Female — Jessica",
    "af_river":   "American Female — River",
    # American male voices
    "am_adam":    "American Male — Adam (deep, confident)",
    "am_michael": "American Male — Michael (warm)",
    # British voices
    "bf_emma":    "British Female — Emma (crisp)",
    "bf_isabella": "British Female — Isabella",
    "bm_george":  "British Male — George (authoritative)",
    "bm_lewis":   "British Male — Lewis",
}

# Voice blends — mixing voices for unique narrator sounds
BLENDS = {
    "blend_storyteller_f": {
        "desc": "Storyteller Female (Bella 60% + Nicole 40%)",
        "mix": "af_bella:0.6,af_nicole:0.4",
    },
    "blend_dramatic_f": {
        "desc": "Dramatic Female (Heart 50% + Nova 50%)",
        "mix": "af_heart:0.5,af_nova:0.5",
    },
    "blend_deep_m": {
        "desc": "Deep Male (Adam 70% + George 30%)",
        "mix": "am_adam:0.7,bm_george:0.3",
    },
    "blend_warm_m": {
        "desc": "Warm Male (Michael 60% + Adam 40%)",
        "mix": "am_michael:0.6,am_adam:0.4",
    },
}


def generate_voice(pipeline, voice_id, voice_desc, text):
    """Generate audio for a single voice and save it."""
    print(f"  🎙️  {voice_id:20s} — {voice_desc}...", end=" ", flush=True)

    try:
        start = time.time()
        audio_chunks = []
        for _, _, audio in pipeline(text, voice=voice_id):
            audio_chunks.append(audio)

        full_audio = np.concatenate(audio_chunks)
        elapsed = time.time() - start

        out_path = os.path.join(OUTPUT_DIR, f"{voice_id}.wav")
        sf.write(out_path, full_audio, 24000)
        print(f"✅ ({elapsed:.1f}s)")
        return True
    except Exception as e:
        print(f"❌ {e}")
        return False


def main():
    print("=" * 60)
    print("  🎧  KOKORO VOICE AUDITION")
    print("  Same dramatic script, every voice. Pick your narrator.")
    print("=" * 60)

    pipeline = KPipeline(lang_code="a")

    # ── Single voices ──
    print(f"\n── Single Voices ({len(VOICES)} total) ──\n")
    for voice_id, desc in VOICES.items():
        generate_voice(pipeline, voice_id, desc, SAMPLE_TEXT)

    # ── Blended voices ──
    print(f"\n── Blended Voices ({len(BLENDS)} total) ──\n")
    for blend_id, info in BLENDS.items():
        generate_voice(pipeline, info["mix"], info["desc"], SAMPLE_TEXT)
        # Rename with blend_id
        mix_safe = info["mix"].replace(":", "_").replace(",", "_")
        src = os.path.join(OUTPUT_DIR, f"{mix_safe}.wav")
        dst = os.path.join(OUTPUT_DIR, f"{blend_id}.wav")
        if os.path.exists(src):
            os.rename(src, dst)

    # ── Summary ──
    wav_files = sorted(f for f in os.listdir(OUTPUT_DIR) if f.endswith(".wav"))
    print(f"\n{'='*60}")
    print(f"  📁 {len(wav_files)} audio files in {OUTPUT_DIR}/")
    print(f"{'='*60}\n")
    for f in wav_files:
        print(f"  🎧 {f}")

    print(f"\n  💡 Tips:")
    print(f"     - For TikTok narration, try: af_bella, af_heart, am_adam")
    print(f"     - Blended voices often sound more unique and engaging")
    print(f"     - You can adjust speed in the pipeline: pipeline(text, voice='...', speed=1.1)")


if __name__ == "__main__":
    main()

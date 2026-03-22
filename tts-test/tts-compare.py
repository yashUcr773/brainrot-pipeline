#!/usr/bin/env python3
"""
TTS Model Comparison Script
============================
Runs the same text through multiple open-source TTS models
so you can compare audio quality side-by-side.

Setup (install one or more):
    pip install chatterbox-tts    # Chatterbox Original + Turbo
    pip install kokoro soundfile  # Kokoro
    apt-get install espeak-ng     # Required by Kokoro
    # brew install espeak-ng      # macOS

Usage:
    python tts_compare.py

Output:
    ./tts_comparison/
      chatterbox_original.wav
      chatterbox_turbo.wav
      kokoro.wav
"""

import os
import time

OUTPUT_DIR = "./tts_comparison"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Test text: a short dramatic excerpt from our pipeline output ──
# Using clean text (no cues) for fair comparison across all models
CLEAN_TEXT = """There was a white van in my backyard. And my dad's best friend just told me to get inside.
Let me explain.
I was walking home from school, sweating like crazy, when Uncle George pulled up in his car.
He's not really my uncle, but he's been Uncle George my whole life.
He waved me over and said, Hop in, kiddo.
Now, my house has a front and a back entrance.
Uncle George drove me around to the back, and that's when I saw it. The van.
Parked right outside, looking wrong.
He told me to wait.
My parents weren't home, and I heard noises coming from inside the house.
My hands were literally shaking.
Four men. Inside my house. Stealing everything.
He saved my life. And he'll never even know it."""

# Same text but with Chatterbox Turbo paralinguistic tags
TURBO_TEXT = """[dramatic] There was a white van in my backyard. And my dad's best friend just told me to get inside.
Let me explain.
I was walking home from school, sweating like crazy, when Uncle George pulled up in his car.
He's not really my uncle, but he's been Uncle George my whole life.
He waved me over and said, Hop in, kiddo. [chuckle]
Now, my house has a front and a back entrance.
Uncle George drove me around to the back, and that's when I saw it. The van.
[whispering] Parked right outside, looking wrong.
He told me to wait.
My parents weren't home, and I heard noises coming from inside the house. [gasp]
My hands were literally shaking.
[angry] Four men. Inside my house. Stealing everything.
[sigh] He saved my life. And he'll never even know it."""

# Reference voice clip for voice cloning (provide your own 5-10s WAV)
# Download a sample or record your own narration voice
# Set to "voice.wav" path for cloning
REFERENCE_VOICE = "./assets/inputs/voice2.wav"


def test_chatterbox_original():
    """Chatterbox Original (0.5B) — best audio quality, emotion exaggeration."""
    print("\n🔊 Testing Chatterbox Original...")
    try:
        import torchaudio as ta
        from chatterbox.tts import ChatterboxTTS

        model = ChatterboxTTS.from_pretrained(
            device="mps")  # Use "cuda" for NVIDIA

        start = time.time()
        wav = model.generate(
            CLEAN_TEXT,
            audio_prompt_path=REFERENCE_VOICE,
            exaggeration=0.7,  # 0.0 = monotone, 1.0+ = very expressive
            cfg_weight=0.5,
        )
        elapsed = time.time() - start

        out_path = os.path.join(OUTPUT_DIR, "chatterbox_original.wav")
        ta.save(out_path, wav, model.sr)
        print(f"   ✅ Saved: {out_path} ({elapsed:.1f}s)")
        return True
    except ImportError:
        print("   ⏭️  Skipped — pip install chatterbox-tts")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def test_chatterbox_turbo():
    """Chatterbox Turbo (350M) — fast, paralinguistic tags, voice cloning."""
    print("\n🔊 Testing Chatterbox Turbo...")
    try:
        import torchaudio as ta
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        model = ChatterboxTurboTTS.from_pretrained(device="mps")

        start = time.time()
        wav = model.generate(
            TURBO_TEXT,
            audio_prompt_path=REFERENCE_VOICE,
        )
        elapsed = time.time() - start

        out_path = os.path.join(OUTPUT_DIR, "chatterbox_turbo.wav")
        ta.save(out_path, wav, model.sr)
        print(f"   ✅ Saved: {out_path} ({elapsed:.1f}s)")
        return True
    except ImportError:
        print("   ⏭️  Skipped — pip install chatterbox-tts")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def test_kokoro():
    """Kokoro (82M) — ultra lightweight, fast, no voice cloning."""
    print("\n🔊 Testing Kokoro...")
    try:
        import soundfile as sf
        from kokoro import KPipeline

        pipeline = KPipeline(lang_code="a")  # 'a' = American English

        start = time.time()
        # Kokoro generates in chunks via a generator
        audio_chunks = []
        for i, (gs, ps, audio) in enumerate(
            # af_heart = female, try am_adam for male
            pipeline(CLEAN_TEXT, voice="af_heart")
        ):
            audio_chunks.append(audio)

        # Concatenate all chunks
        import numpy as np

        full_audio = np.concatenate(audio_chunks)
        elapsed = time.time() - start

        out_path = os.path.join(OUTPUT_DIR, "kokoro.wav")
        sf.write(out_path, full_audio, 24000)
        print(f"   ✅ Saved: {out_path} ({elapsed:.1f}s)")
        return True
    except ImportError:
        print("   ⏭️  Skipped — pip install kokoro soundfile (+ espeak-ng)")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def main():
    print("=" * 55)
    print("  🎧  TTS MODEL COMPARISON")
    print("  Same script, different voices. Compare the WAVs.")
    print("=" * 55)

    results = {}
    # results["chatterbox_original"] = test_chatterbox_original()
    results["chatterbox_turbo"] = test_chatterbox_turbo()
    # results["kokoro"] = test_kokoro()

    print(f"\n{'='*55}")
    print(f"  📁 Output: {OUTPUT_DIR}/")
    print(f"{'='*55}")
    for name, ok in results.items():
        status = "✅" if ok else "⏭️ "
        print(f"  {status} {name}.wav")

    tested = sum(1 for v in results.values() if v)
    if tested == 0:
        print("\n  ⚠️  No models installed! Install at least one:")
        print("     pip install chatterbox-tts")
        print("     pip install kokoro soundfile && brew install espeak-ng")
    else:
        print(f"\n  🎧 Listen to the {tested} WAV file(s) and compare!")
        print("  Tip: for voice cloning, set REFERENCE_VOICE to a 5-10s WAV")


if __name__ == "__main__":
    main()

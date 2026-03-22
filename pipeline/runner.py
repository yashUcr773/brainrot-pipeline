"""
End-to-end pipeline orchestrator.

Wires every pipeline step together:
  1. Scrape Reddit
  2. Clean text
  3. Rewrite with LLM
  4. Format for TTS
  5. Generate audio (Kokoro)
  6. Extract word timestamps (Whisper)
  7. Generate ASS subtitles
  8. Render final videos (FFmpeg)

Each step writes its artefacts to a timestamped run directory under
``assets/``, making every run fully reproducible and auditable.
"""

import json
import os

from pipeline.config import (
    CONTENT_FILENAME,
    REDDIT_SUBS,
    ROOT_ASSETS_PATH,
)
from pipeline.ollama_manager import setup_ollama
from pipeline.scraper import get_raw_content
from pipeline.cleaner import clean_text
from pipeline.rewriter import rewrite_dramatic
from pipeline.tts_formatter import format_for_tts, estimate_duration
from pipeline.audio import generate_audio
from pipeline.timestamps import extract_word_timestamps, group_words_into_chunks
from pipeline.subtitles import generate_ass_subtitles
from pipeline.video import generate_video


def _save_text(path: str, text: str) -> None:
    """Write *text* to *path* with UTF-8 encoding."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _save_json(path: str, data) -> None:
    """Write *data* as pretty-printed JSON."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def run_pipeline(
    *,
    subs: list[str] | None = None,
    voice: str | None = None,
    temperature: float = 0.9,
    skip_video: bool = False,
) -> str:
    """
    Execute the full Reddit → TikTok pipeline.

    Parameters
    ----------
    subs : list[str] | None
        Override the default subreddit list.
    voice : str | None
        Force a specific Kokoro voice.  ``None`` picks randomly.
    temperature : float
        LLM sampling temperature for the rewriter.
    skip_video : bool
        If ``True``, stop after subtitle generation (useful for testing).

    Returns
    -------
    str
        Path to the run output directory.
    """
    subs = subs or REDDIT_SUBS

    # ── Bootstrap Ollama ──────────────────────────────────────────────────
    setup_ollama()

    # ── Prepare output directory ──────────────────────────────────────────
    dir_path = os.path.join(ROOT_ASSETS_PATH)
    os.makedirs(dir_path, exist_ok=True)
    content_path = os.path.join(dir_path, CONTENT_FILENAME)

    # ── Step 0: Scrape Reddit ─────────────────────────────────────────────
    raw_content = get_raw_content(subs)
    _save_json(content_path, raw_content)

    title = raw_content["title"]
    body = raw_content["content"]

    print(f"\n📌 Post: {title}")
    print(f"   From: {raw_content['subreddit']} | ↑{raw_content['score']}")
    print(f"   Length: {len(body)} chars\n")

    # ── Step 1: Clean text ────────────────────────────────────────────────
    print("📝 Step 1: Cleaning...")
    cleaned = clean_text(body)
    print(f"   {len(body)} → {len(cleaned)} chars ({len(body) - len(cleaned)} removed)\n")
    _save_text(os.path.join(dir_path, "01_cleaned.txt"), cleaned)

    # ── Step 2: Dramatic rewrite ──────────────────────────────────────────
    dramatic = rewrite_dramatic(cleaned, title, temperature=temperature)
    _save_text(os.path.join(dir_path, "02_dramatic.txt"), dramatic)

    # ── Step 3: Format for TTS ────────────────────────────────────────────
    print("\n🎙️  Step 3: Formatting for TTS...")
    tts_lines = format_for_tts(dramatic)
    duration = estimate_duration(tts_lines)
    word_count = sum(len(line["text_clean"].split()) for line in tts_lines)
    all_cues = [cue for line in tts_lines for cue in line["cues"]]

    print(f"   Lines:    {len(tts_lines)}")
    print(f"   Words:    {word_count}")
    print(f"   Duration: ~{int(duration // 60)}:{int(duration % 60):02d}")
    print(f"   Cues:     {len(all_cues)}")

    # Raw TTS lines (JSON dump for debugging)
    _save_json(os.path.join(dir_path, "03_tts_script_raw.txt"), tts_lines)

    # Script with cues (for review / cue-aware TTS)
    _save_text(
        os.path.join(dir_path, "03_tts_script.txt"),
        "\n".join(line["text_with_cues"] for line in tts_lines) + "\n",
    )

    # Clean text only (for TTS models that don't understand cues)
    _save_text(
        os.path.join(dir_path, "03_tts_clean.txt"),
        "\n".join(line["text_clean"] for line in tts_lines) + "\n",
    )

    # Structured JSON (for programmatic TTS pipelines)
    _save_json(
        os.path.join(dir_path, "03_tts_data.json"),
        {
            "title": title,
            "subreddit": raw_content["subreddit"],
            "total_lines": len(tts_lines),
            "word_count": word_count,
            "estimated_duration_seconds": duration,
            "lines": tts_lines,
        },
    )

    # ── Step 4: Generate audio ────────────────────────────────────────────
    audio_path, voice_used = generate_audio(tts_lines, dir_path, voice=voice)

    # ── Step 5: Word timestamps ───────────────────────────────────────────
    words = extract_word_timestamps(audio_path)
    chunks = group_words_into_chunks(words, words_per_chunk=5)
    print(f"   Chunks: {len(chunks)} (5 words each)")

    _save_json(os.path.join(dir_path, "05_word_timestamps.json"), words)
    _save_json(os.path.join(dir_path, "05_subtitle_chunks.json"), chunks)

    # ── Step 6: ASS subtitles ─────────────────────────────────────────────
    ass_9x16 = generate_ass_subtitles(
        chunks,
        os.path.join(dir_path, "06_subtitles_9x16.ass"),
        video_width=1080,
        video_height=1920,
    )
    ass_16x9 = generate_ass_subtitles(
        chunks,
        os.path.join(dir_path, "06_subtitles_16x9.ass"),
        video_width=1920,
        video_height=1080,
    )

    # ── Step 7: Generate videos ───────────────────────────────────────────
    video_9x16 = None
    video_16x9 = None

    if not skip_video:
        print(f"\n🎬 Step 7: Generating videos...")

        video_9x16 = generate_video(
            audio_path, ass_9x16, dir_path,
            "07_final_9x16.mp4", 1080, 1920,
        )
        video_16x9 = generate_video(
            audio_path, ass_16x9, dir_path,
            "07_final_16x9.mp4", 1920, 1080,
        )

    # ── Summary ───────────────────────────────────────────────────────────
    _print_summary(dir_path, voice_used, video_9x16, video_16x9)

    return dir_path


def _print_summary(
    dir_path: str,
    voice_used: str,
    video_9x16: str | None,
    video_16x9: str | None,
) -> None:
    """Print a compact run summary listing all generated artefacts."""
    print(f"\n✅ Done! Output in {dir_path}/")
    print(f"   📄 01_cleaned.txt            — cleaned source text")
    print(f"   📄 02_dramatic.txt           — LLM rewrite")
    print(f"   📄 03_tts_script_raw.txt     — TTS RAW OUTPUT")
    print(f"   📄 03_tts_script.txt         — TTS script with audio cues")
    print(f"   📄 03_tts_clean.txt          — clean text only (no cues)")
    print(f"   📄 03_tts_data.json          — structured data for TTS pipeline")
    print(f"   🔊 04_narration.wav          — audio narration ({voice_used})")
    print(f"   📄 04_audio_meta.json        — audio metadata")
    print(f"   📄 05_word_timestamps.json   — per-word timing")
    print(f"   📄 05_subtitle_chunks.json   — 5-word subtitle groups")
    print(f"   📄 06_subtitles_9x16.ass     — subtitles for TikTok/Reels")
    print(f"   📄 06_subtitles_16x9.ass     — subtitles for YouTube")
    if video_9x16:
        print(f"   🎬 07_final_9x16.mp4        — TikTok/Reels video")
    if video_16x9:
        print(f"   🎬 07_final_16x9.mp4        — YouTube video")

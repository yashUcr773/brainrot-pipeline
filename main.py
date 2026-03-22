#!/usr/bin/env python3
"""
Reddit → TikTok Viral Script Pipeline
Scrape → Clean → Rewrite (Ollama) → Format → Audio (Kokoro) → Timestamps (Whisper) → Subtitles → Video (FFmpeg)

Usage:
    python main.py                  # run full pipeline with defaults
    python main.py --skip-video     # stop after subtitle generation
    python main.py --voice af_heart # force a specific Kokoro voice
"""

from pipeline import run_pipeline


def main():
    run_pipeline()


if __name__ == "__main__":
    main()

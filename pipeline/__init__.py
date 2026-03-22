"""
pipeline — Modular Reddit-to-TikTok content generation pipeline.

Modules:
    config          — Central configuration constants
    ollama_manager  — Ollama server lifecycle management
    scraper         — Reddit post scraping and selection
    cleaner         — Text cleaning and abbreviation expansion
    rewriter        — LLM-powered dramatic rewriting
    tts_formatter   — TTS line parsing and duration estimation
    audio           — Kokoro TTS audio generation
    timestamps      — Whisper word-level timestamp extraction
    subtitles       — ASS subtitle file generation
    video           — FFmpeg video compositing
    runner          — End-to-end pipeline orchestrator
"""

from pipeline.runner import run_pipeline

__all__ = ["run_pipeline"]

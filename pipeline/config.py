"""
Central configuration for the brainrot pipeline.

All tuneable constants live here. Import from this module instead of
hard-coding values in individual pipeline steps.
"""

import time

# ── Reddit ────────────────────────────────────────────────────────────────────

REDDIT_BASE_URL = "https://www.reddit.com"

REDDIT_SUBS = [
    "AmItheAsshole",
    "relationship_advice",
    "TrueOffMyChest",
    "confessions",
    "TIFU",
    "EntitledParents",
    "ChoosingBeggars",
    "antiwork",
    "MaliciousCompliance",
]

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT_ASSETS_PATH = "./assets/outputs"
CONTENT_FILENAME = "content.json"


# ── Ollama / LLM ─────────────────────────────────────────────────────────────

OLLAMA_URL = "http://localhost:11434"
OLLAMA_MODEL = "gemma3:12b"

# ── Kokoro TTS ────────────────────────────────────────────────────────────────

KOKORO_VOICES = [
    "af_heart", "af_bella", "af_sarah",
    "af_nova", "af_sky", "af_jessica", "af_river",
    "am_adam", "am_michael", "bm_george", "bm_lewis",
]

# ── Video / FFmpeg ────────────────────────────────────────────────────────────

BACKGROUND_VIDEO_DIR = "./assets/inputs/backgrounds"
BACKGROUND_VIDEO_FILE = None  # Set to None to pick a random file from dir

# ── Subtitle styling ─────────────────────────────────────────────────────────

SUB_FONT = "Arial"
SUB_FONTSIZE_NORMAL = 64
SUB_FONTSIZE_HIGHLIGHT = 78
SUB_COLOR_NORMAL = "#FFFFFF"
SUB_COLOR_HIGHLIGHT = "#FFFF00"
SUB_COLOR_OUTLINE = "#000000"
SUB_OUTLINE_WIDTH = 4

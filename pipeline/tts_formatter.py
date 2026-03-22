"""
TTS formatting and duration estimation.

Parses the dramatic script into structured lines ready for a TTS engine,
separating clean speakable text from audio cues.  Also provides a quick
word-count-based narration duration estimate.
"""

import re

# Regex matching all recognised audio cues
CUE_PATTERN = (
    r"\[(?:pause|long pause|dramatic pause|whisper|/whisper|loud|/loud|"
    r"speed up|/speed up|slow|/slow|gasp|sigh|laugh|sfx:[^\]]*)\]"
)


def format_for_tts(script: str) -> list[dict]:
    """
    Parse a dramatic script into structured TTS-ready lines.

    Each returned dict contains:
        - ``index`` — 1-based line number
        - ``text_with_cues`` — the raw line (cues intact)
        - ``text_clean`` — speakable text only
        - ``cues`` — list of extracted cue strings

    Standalone cue-only lines (e.g. ``[gasp]``) are attached to the
    previous spoken line so that TTS engines never receive an empty string.

    Parameters
    ----------
    script : str
        Dramatic narration script (output of the rewriter).

    Returns
    -------
    list[dict]
    """
    lines: list[dict] = []
    idx = 0

    for raw_line in script.split("\n"):
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        cues = re.findall(CUE_PATTERN, raw_line, re.IGNORECASE)
        clean = re.sub(CUE_PATTERN + r"\s*", "", raw_line, flags=re.IGNORECASE)
        clean = re.sub(r"\s+", " ", clean).strip()

        # Standalone cue line → attach to previous spoken line
        if not clean:
            if lines:
                lines[-1]["cues"].extend(cues)
            continue

        idx += 1
        lines.append({
            "index": idx,
            "text_with_cues": raw_line,
            "text_clean": clean,
            "cues": cues,
        })

    return lines


def estimate_duration(tts_lines: list[dict], wpm: int = 160) -> float:
    """
    Rough narration duration in seconds from word count + pause cues.

    Parameters
    ----------
    tts_lines : list[dict]
        Output of :func:`format_for_tts`.
    wpm : int
        Assumed words-per-minute speaking speed.

    Returns
    -------
    float
        Estimated duration (seconds), rounded to one decimal.
    """
    words = sum(len(line["text_clean"].split()) for line in tts_lines)
    base = (words / wpm) * 60

    pause_time = 0.0
    for line in tts_lines:
        for cue in line["cues"]:
            if "long pause" in cue or "dramatic pause" in cue:
                pause_time += 2.0
            elif "pause" in cue:
                pause_time += 0.8
            elif cue in ("[gasp]", "[sigh]", "[laugh]"):
                pause_time += 0.5

    return round(base + pause_time, 1)

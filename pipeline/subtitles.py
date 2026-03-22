"""
ASS (Advanced SubStation Alpha) subtitle generation.

Produces subtitle files with per-word highlighting: the active word is
rendered in a larger, coloured font while the rest of the chunk stays white.
"""

from pipeline.config import (
    SUB_FONT,
    SUB_FONTSIZE_HIGHLIGHT,
    SUB_FONTSIZE_NORMAL,
    SUB_COLOR_HIGHLIGHT,
    SUB_COLOR_NORMAL,
    SUB_COLOR_OUTLINE,
    SUB_OUTLINE_WIDTH,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ass_timestamp(seconds: float) -> str:
    """Convert seconds to ASS timestamp format ``H:MM:SS.cc``."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_color(hex_rgb: str) -> str:
    """Convert ``#RRGGBB`` to the ASS colour format ``&HBBGGRR&``."""
    r = hex_rgb[1:3]
    g = hex_rgb[3:5]
    b = hex_rgb[5:7]
    return f"&H{b}{g}{r}&"


# ── Public API ────────────────────────────────────────────────────────────────

def generate_ass_subtitles(
    chunks: list[dict],
    output_path: str,
    video_width: int = 1080,
    video_height: int = 1920,
) -> str:
    """
    Generate an ASS subtitle file with word-by-word highlighting.

    For every word in every chunk a dialogue line is emitted showing the full
    chunk text.  The currently active word is rendered in the highlight colour
    at a larger font size; all other words use the default style.

    Parameters
    ----------
    chunks : list[dict]
        Output of :func:`pipeline.timestamps.group_words_into_chunks`.
    output_path : str
        Destination ``.ass`` file path.
    video_width : int
        PlayResX value (matches target video width).
    video_height : int
        PlayResY value (matches target video height).

    Returns
    -------
    str
        The *output_path* that was written (pass-through for chaining).
    """
    print(f"\n📝 Step 6: Generating ASS subtitles...")

    normal_color = _ass_color(SUB_COLOR_NORMAL)
    highlight_color = _ass_color(SUB_COLOR_HIGHLIGHT)
    outline_color = _ass_color(SUB_COLOR_OUTLINE)

    # ── ASS header ────────────────────────────────────────────────────────
    header = f"""[Script Info]
Title: TikTok Narration Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{SUB_FONT},{SUB_FONTSIZE_NORMAL},{normal_color},&H000000FF&,{outline_color},&H80000000&,-1,0,0,0,100,100,0,0,1,{SUB_OUTLINE_WIDTH},0,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # ── Dialogue lines ────────────────────────────────────────────────────
    dialogue_lines: list[str] = []

    for chunk in chunks:
        words = chunk["words"]

        for i, active_word in enumerate(words):
            parts: list[str] = []
            for j, w in enumerate(words):
                if j == i:
                    # Highlighted: yellow, bold, bigger
                    parts.append(
                        f"{{\\b1\\fs{SUB_FONTSIZE_HIGHLIGHT}"
                        f"\\c{highlight_color}"
                        f"\\3c{outline_color}}}"
                        f"{w['word']}"
                        f"{{\\r}}"
                    )
                else:
                    parts.append(w["word"])

            text = " ".join(parts)
            start = _ass_timestamp(active_word["start"])
            end = _ass_timestamp(active_word["end"])

            dialogue_lines.append(
                f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}"
            )

    # ── Write file ────────────────────────────────────────────────────────
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header)
        for line in dialogue_lines:
            f.write(line + "\n")

    print(f"   Lines: {len(dialogue_lines)}")
    print(f"   ✅ Saved: {output_path}")

    return output_path

"""
Video generation with FFmpeg.

Composites the final video by overlaying burnt-in ASS subtitles onto a
background gameplay clip, then merging the narration audio track.
"""

import os
import random
import shutil
import subprocess

from pipeline.config import BACKGROUND_VIDEO_DIR, BACKGROUND_VIDEO_FILE


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_video_duration(video_path):
    """Return video duration in seconds via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(result.stdout.strip())


def _get_background_video(
    bg_dir: str | None = None,
    bg_file: str | None = None,
) -> str:
    """
    Resolve the background video file path.

    Uses the module-level config defaults when arguments are ``None``.
    If *bg_file* is falsy, a random video from *bg_dir* is chosen.
    """
    bg_dir = bg_dir or BACKGROUND_VIDEO_DIR
    bg_file = bg_file or BACKGROUND_VIDEO_FILE

    if bg_file:
        path = os.path.join(bg_dir, bg_file)
    else:
        files = [
            f for f in os.listdir(bg_dir)
            if f.endswith((".mp4", ".mov", ".mkv", ".webm"))
        ]
        if not files:
            raise FileNotFoundError(f"No video files in {bg_dir}")
        path = os.path.join(bg_dir, random.choice(files))

    if not os.path.exists(path):
        raise FileNotFoundError(f"Background video not found: {path}")

    return path


# ── Public API ────────────────────────────────────────────────────────────────

def generate_video(
    audio_path: str,
    ass_path: str,
    dir_path: str,
    output_name: str,
    width: int,
    height: int,
    bg_dir: str | None = None,
    bg_file: str | None = None,
) -> str | None:
    """
    Composite final video: background + subtitles + narration audio.

    The render is a two-pass process:
      A. Crop/scale background, burn in ASS subtitles (no audio).
      B. Mux the narration audio onto the video stream.

    Parameters
    ----------
    audio_path : str
        Path to the narration WAV file.
    ass_path : str
        Path to the ``.ass`` subtitle file.
    dir_path : str
        Output directory for the final video and temp files.
    output_name : str
        Filename for the final output (e.g. ``"07_final_9x16.mp4"``).
    width, height : int
        Target video resolution.
    bg_dir, bg_file : str | None
        Override background video location; falls back to config.

    Returns
    -------
    str | None
        Path to the rendered video, or ``None`` on failure.
    """
    bg_video = _get_background_video(bg_dir, bg_file)
    bg_duration = _get_video_duration(bg_video)
    audio_duration = _get_video_duration(audio_path)

    # Pick a random start point so the background isn't always the same clip
    max_start = max(0, bg_duration - audio_duration - 5)
    start_time = random.uniform(0, max_start) if max_start > 0 else 0

    output_path = os.path.join(dir_path, output_name)
    target_aspect = width / height

    # Copy ASS to a short temp name (avoids path-escaping issues in ffmpeg)
    temp_subs = os.path.join(dir_path, "_temp_subs.ass")
    temp_video = os.path.join(dir_path, "_temp_video.mp4")
    shutil.copy2(ass_path, temp_subs)

    print(f"   Rendering {output_name}...")
    print(f"   Background: {os.path.basename(bg_video)} (start {start_time:.1f}s)")

    import time as _time
    start = _time.time()

    # ── Step A: Video + subtitles (no audio) ──────────────────────────────
    cmd_video = [
        "ffmpeg", "-y",
        "-ss", str(round(start_time, 2)),
        "-t", str(round(audio_duration + 0.5, 2)),
        "-i", bg_video,
        "-filter_complex",
        (
            f"[0:v]crop=ih*{target_aspect}:ih:(iw-ih*{target_aspect})/2:0,"
            f"scale={width}:{height},ass={temp_subs}[v]"
        ),
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-an",
        temp_video,
    ]

    result = subprocess.run(cmd_video, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"   ❌ FFmpeg Step A error:\n{result.stderr[-500:]}")
        _cleanup(temp_subs, temp_video)
        return None

    # ── Step B: Merge with audio ──────────────────────────────────────────
    cmd_merge = [
        "ffmpeg", "-y",
        "-i", temp_video,
        "-i", audio_path,
        "-c:v", "copy",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]

    result = subprocess.run(cmd_merge, capture_output=True, text=True)
    _cleanup(temp_subs, temp_video)

    if result.returncode != 0:
        print(f"   ❌ FFmpeg Step B error:\n{result.stderr[-500:]}")
        return None

    elapsed = _time.time() - start
    print(f"   ✅ {output_name} ({elapsed:.1f}s)")
    return output_path


def _cleanup(*paths: str) -> None:
    """Silently remove temp files."""
    for p in paths:
        if os.path.exists(p):
            os.remove(p)

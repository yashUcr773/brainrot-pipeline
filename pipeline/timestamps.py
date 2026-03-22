"""
Word-level timestamp extraction via faster-whisper.

Runs an ASR model on the generated audio to obtain per-word timing, then
groups words into display chunks suitable for subtitle rendering.
"""

import time

from faster_whisper import WhisperModel


def extract_word_timestamps(
    audio_path: str,
    model_size: str = "base",
    device: str = "cpu",
    compute_type: str = "int8",
) -> list[dict]:
    """
    Transcribe *audio_path* and return word-level timestamps.

    Parameters
    ----------
    audio_path : str
        Path to the WAV narration file.
    model_size : str
        Whisper model size (``"tiny"``, ``"base"``, ``"small"``, etc.).
    device : str
        Inference device (``"cpu"`` or ``"cuda"``).
    compute_type : str
        Quantisation type (``"int8"``, ``"float16"``, …).

    Returns
    -------
    list[dict]
        Each dict: ``{"word": str, "start": float, "end": float}``.
    """
    print(f"\n🎯 Step 5: Extracting word timestamps...")
    print(f"   Model: {model_size}")

    start = time.time()
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    segments, _ = model.transcribe(
        audio_path,
        word_timestamps=True,
        language="en",
    )

    words: list[dict] = []
    for segment in segments:
        for word in segment.words:
            words.append({
                "word": word.word.strip(),
                "start": round(word.start, 3),
                "end": round(word.end, 3),
            })

    elapsed = time.time() - start
    print(f"   Words: {len(words)}")
    print(f"   Processed: {elapsed:.1f}s")

    return words


def group_words_into_chunks(
    words: list[dict],
    words_per_chunk: int = 5,
) -> list[dict]:
    """
    Group words into display chunks of *words_per_chunk* words.

    Parameters
    ----------
    words : list[dict]
        Output of :func:`extract_word_timestamps`.
    words_per_chunk : int
        Number of words per subtitle chunk.

    Returns
    -------
    list[dict]
        Each dict: ``{"index", "text", "start", "end", "words"}``.
    """
    chunks: list[dict] = []
    for i in range(0, len(words), words_per_chunk):
        group = words[i : i + words_per_chunk]
        chunks.append({
            "index": len(chunks),
            "text": " ".join(w["word"] for w in group),
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "words": group,
        })
    return chunks

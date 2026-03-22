#!/usr/bin/env python3
"""
Reddit → TikTok Viral Script Pipeline
Scrape → Clean → Rewrite (Ollama) → Format → Audio (Kokoro) → Word Timestamps (Whisper)
"""

import atexit
import json
import os
import random
import re
import subprocess
import time

import ollama as ollama_lib
import requests

import numpy as np
import soundfile as sf
from kokoro import KPipeline

from faster_whisper import WhisperModel
# =========================
# CONFIG
# =========================

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
ROOT_ASSETS_PATH = "./assets"
CONTENT_PATH = "content.json"
RUN_TIMESTAMP = int(time.time() * 1000)

OLLAMA_URL = "http://localhost:11434"
# Model options — try these in order until you find one you like:
# "gemma3:12b"                       — best instruction following + creative, fits easily
# "mistral:7b-instruct-v0.3-q8_0"   — excellent at dramatic writing
# "llama3.1:70b-instruct-q4_K_M"    — best overall quality, slower (fits 48GB)
# "llama3.1:8b-instruct-q8_0"       — fast, decent baseline

OLLAMA_MODEL = "gemma3:12b"
# OLLAMA_MODEL = "llama3.1:8b-instruct-q8_0"
# OLLAMA_MODEL = "llama3.1:70b-instruct-q4_K_M"
# OLLAMA_MODEL = "mistral:7b-instruct-v0.3-q8_0"

ollama_process = None
started_by_script = False

# =========================
# KOKORO CONFIG
# =========================

KOKORO_VOICES = [
    "af_heart", "af_bella", "af_sarah", "af_nicole",
    "af_nova", "af_sky", "af_jessica", "af_river",
    "am_adam", "am_michael", "bm_george", "bm_lewis",
]


# =========================
# OLLAMA MANAGEMENT
# =========================

def is_ollama_running():
    try:
        requests.get(OLLAMA_URL)
        return True
    except:
        return False


def start_ollama():
    global started_by_script

    if is_ollama_running():
        print("⚡ Ollama already running")
        return None

    print("🚀 Starting Ollama...")
    process = subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={
            **os.environ,
            "OLLAMA_METAL": "1",
            "OLLAMA_MAX_LOADED_MODELS": "1",
            "OLLAMA_NUM_PARALLEL": "1",
        },
    )
    started_by_script = True

    for _ in range(30):
        if is_ollama_running():
            print("✅ Ollama ready")
            return process
        time.sleep(0.5)

    raise RuntimeError("❌ Ollama failed to start")


def stop_ollama(process):
    if process and started_by_script:
        print("🛑 Stopping Ollama...")
        process.terminate()


def ensure_model():
    try:
        ollama_lib.show(OLLAMA_MODEL)
    except:
        print("⬇️ Pulling model...")
        subprocess.run(["ollama", "pull", OLLAMA_MODEL])


def setup_ollama():
    global ollama_process
    ollama_process = start_ollama()
    ensure_model()
    atexit.register(lambda: stop_ollama(ollama_process))


# =========================
# REDDIT SCRAPING
# =========================

def get_raw_content(subs):
    if not subs:
        raise ValueError("Subreddit list is empty")

    dir_path = os.path.join(ROOT_ASSETS_PATH, "rawContent")
    os.makedirs(dir_path, exist_ok=True)

    headers = {"User-Agent": "MyRedditApp/1.0"}
    responses = []
    for sub in subs:
        url = f"{REDDIT_BASE_URL}/r/{sub}/top.json"
        params = {"limit": 10, "t": "day"}
        res = requests.get(url, headers=headers, params=params)
        res.raise_for_status()
        responses.append(res.json())

    all_posts = []
    for res in responses:
        children = res.get("data", {}).get("children", [])
        all_posts.extend([c.get("data", {}) for c in children])

    with open(os.path.join(dir_path, "allPosts.json"), "w", encoding="utf-8") as f:
        json.dump(all_posts, f, indent=2)

    filtered_posts = [
        post
        for post in all_posts
        if post.get("selftext")
        and len(post.get("selftext", "")) >= 500
        and not post.get("stickied", False)
    ]

    if not filtered_posts:
        raise ValueError("No suitable posts found")

    filtered_posts.sort(key=lambda x: x.get("score", 0), reverse=True)
    top_n = filtered_posts[:3]
    best_post = random.choice(top_n)

    return {
        "subreddit": best_post.get("subreddit_name_prefixed"),
        "title": best_post.get("title"),
        "content": best_post.get("selftext"),
        "author": best_post.get("author"),
        "url": REDDIT_BASE_URL + best_post.get("permalink", ""),
        "score": best_post.get("score"),
    }


# =========================
# STEP 1: CLEAN TEXT
# =========================

REMOVE_PATTERNS = [
    r"(?i)throwaway\s+(account|because).*?[\.\n]",
    r"(?i)(obligatory\s+)?this\s+(didn'?t|did\s+not)\s+happen\s+today.*?[\.\n]",
    r"(?i)sorry\s+for\s+(the\s+)?formatting.*?[\.\n]",
    r"(?i)on\s+mobile.*?[\.\n]",
    r"(?i)english\s+is\s+not\s+my\s+(first|native)\s+language.*?[\.\n]",
    r"(?i)using\s+a\s+throwaway.*?[\.\n]",
    r"(?i)\n*edit\s*\d*\s*:.*?(?=\n\n|\Z)",
    r"(?i)\n*update\s*\d*\s*:.*?(?=\n\n|\Z)",
    r"(?i)\n*tl\s*;?\s*dr\s*:?.*?(?=\n\n|\Z)",
    r"(?i)thanks?\s+for\s+the\s+(gold|silver|awards?).*?[\.\n]",
    r"(?i)wow\s+this\s+(blew\s+up|got\s+big).*?[\.\n]",
    r"https?://\S+",
    r"r/\w+",
    r"u/\w+",
]

ABBREVIATIONS = {
    r"\bAITA\b": "Am I the asshole",
    r"\bNTA\b": "not the asshole",
    r"\bYTA\b": "you're the asshole",
    r"\bTIFU\b": "Today I messed up",
    r"\bMIL\b": "mother-in-law",
    r"\bFIL\b": "father-in-law",
    r"\bSIL\b": "sister-in-law",
    r"\bBIL\b": "brother-in-law",
    r"\bSO\b": "significant other",
    r"\bOP\b": "the original poster",
    r"\bTBH\b": "to be honest",
    r"\bIDK\b": "I don't know",
    r"\bSMH\b": "shaking my head",
}


def clean_text(raw_text):
    """Strip Reddit formatting, boilerplate, expand abbreviations."""
    text = raw_text

    for pattern in REMOVE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.DOTALL)

    # Strip markdown, keep text inside
    text = re.sub(r"\*\*\*(.*?)\*\*\*", r"\1", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"\*(.*?)\*", r"\1", text)
    text = re.sub(r"~~(.*?)~~", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^>\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", text)
    text = re.sub(r"&amp;", "&", text)

    for abbr, expansion in ABBREVIATIONS.items():
        text = re.sub(abbr, expansion, text)

    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


# =========================
# STEP 2: REWRITE WITH LLM
# =========================

REWRITE_PROMPT = """You are a TikTok storytelling scriptwriter who makes videos go viral. You take Reddit posts and rewrite them as dramatic narration scripts that are impossible to scroll past.

═══ HOOK (FIRST 2 LINES) ═══

The hook is EVERYTHING. If the first line doesn't stop the scroll, nothing else matters.

RULES for the hook:
- Start with the most SHOCKING or CONFUSING moment from the story, ripped out of context
- NEVER start with backstory, setup, or "So this happened..."
- The listener should think "WAIT WHAT?" and need to keep listening
- After the hook line, add a rewind line like "Let me back up." or "Okay let me explain."

GOOD hooks (study these):
- "There were 4 strangers inside my house. And I almost walked right into them."
- "My mother-in-law walked into my bedroom at 7 AM. Without knocking. Without calling. While I was asleep."
- "I just watched my best friend's wedding video. I'm in it. Except nobody invited me."
- "My boss just Venmo'd me $1. With the memo: 'Your raise.'"
- "I found my husband's second phone. The wallpaper was a woman I've never seen. With my kids."

BAD hooks (never do these):
- "Today my life changed forever..." (generic, boring)
- "So this is a crazy story..." (tells instead of shows)
- "You won't believe what happened to me..." (overused, no specifics)
- "[hook]" or "HOOK:" (never output labels or meta-tags)

═══ PACING & CLIFFHANGERS ═══

Every 3-4 sentences, insert a TENSION BEAT — a line that makes the listener lean in:
- "But here's the part that still keeps me up at night."
- "And that's when I looked down and saw it."
- "Y'all... I was NOT ready for what happened next."
- "Now this is where the story goes completely off the rails."
- "And just when I thought it couldn't get worse..."

Use SHORT punchy sentences at high-tension moments:
"I froze. Dead silent. Four men. In my house."

Use LONGER sentences for scene-setting and building atmosphere.

The LAST LINE of the script must be either:
- A gut-punch emotional closer ("He saved my life. And he'll never even know it.")
- A cliffhanger that forces comments ("That was six months ago. She still hasn't spoken to me.")
- A dark irony callback to the hook ("Remember that white van? It's parked outside again.")
- A twist reframe ("Turns out, he wasn't protecting me from them. He was protecting them from what I would've done.")

IMPORTANT: Vary your closers. Do NOT fall back on the same pattern every time (e.g. never repeatedly use "And the worst part?" as a closer — find a fresh angle for each story).

═══ AUDIO CUES ═══

Insert these cues EXACTLY as written (lowercase, in brackets). These control how the TTS reads the script.

Pacing cues — use between sentences:
[pause] — short 1-second beat. Use after a setup line, before a punchline.
[long pause] — 2 seconds. Use after a revelation that needs to sink in.
[dramatic pause] — 2 seconds. Use ONLY right before the biggest twist/climax. MAXIMUM ONE PER SCRIPT. If you use [dramatic pause] more than once, you dilute its power and it means nothing. Pick the single most important moment and save it for that.

Voice cues — wrap around text:
[whisper]text here[/whisper] — secrets, creepy details, confessions
[loud]text here[/loud] — arguments, confrontations, shock reactions
[speed up]text here[/speed up] — panic, urgency, things spiraling fast
[slow]text here[/slow] — weight, emphasis, devastating realizations

Reaction cues — standalone on their own line:
[gasp]
[sigh]
[laugh]

Sound effects — standalone (must match the actual scene, don't add random sfx):
[sfx: phone buzzing]
[sfx: door slam]
[sfx: police sirens]

CUE PLACEMENT RULES:
- Every script should have at LEAST 8-10 cues total
- Place [pause] after EVERY hook line and cliffhanger line
- Place [dramatic pause] exactly ONCE per script — this is the nuclear option, save it for the single biggest reveal. Using it twice or more is a hard rule violation.
- Use [whisper] for the scariest or most intimate detail
- Use [loud] for confrontations or the moment everything explodes
- Reaction cues ([gasp], [sigh]) go on their OWN line, between sentences
- NEVER output invalid cues like [hook], [Loud], [PAUSE], [dramatic]. Use ONLY the exact cues listed above.

═══ TONE ═══

Write like you're breathlessly telling this story to your best friend at 2 AM.
- Contractions always: "I'm", "didn't", "couldn't", "wouldn't"
- Rhetorical questions to pull the listener in: "Like, who DOES that?"
- Second person to make it feel personal: "Imagine YOU walk up to your front door and hear voices inside."
- Emotional reactions embedded in the narration: "My hands were literally shaking."
- NEVER use: "furthermore", "however", "additionally", "indeed", "moreover"

═══ STRUCTURE ═══

Follow this arc for every script:
1. HOOK — shocking moment, out of context (2 lines)
2. REWIND — "Let me explain" / quick setup (3-4 lines)
3. RISING TENSION — things start going wrong, build dread (5-6 lines)
4. CLIMAX — the moment everything hits the fan (3-4 lines)
5. FALLOUT — aftermath, emotional reaction (2-3 lines)
6. CLOSER — gut-punch final line or cliffhanger (1-2 lines)

═══ ABSOLUTE FORMAT RULES ═══

- Output ONLY the narration script. Nothing else.
- One sentence per line.
- Audio cues either inline with text OR on their own line.
- NEVER output labels, headers, section names, or meta-commentary like "[hook]", "HOOK:", "Opening:", "Section 1", "Here's the rewrite".
- NEVER number the lines.
- NEVER add stage directions in parentheses like (narrator whispers).
- NEVER explain what you're doing. Just write the script.
- The very first character of your output should be the first word of the hook sentence."""


def rewrite_dramatic(cleaned_text, title="", temperature=0.9):
    """Send full cleaned text to Ollama for dramatic rewrite."""
    user_msg = (
        f"TITLE: {title}\n\n"
        f"ORIGINAL POST:\n{cleaned_text}\n\n"
        "Rewrite this as a viral TikTok narration script. "
        "Do NOT just retell the story — TRANSFORM it. "
        "Restructure the timeline, punch up the drama, add tension beats and audio cues. "
        "Start output directly with the hook sentence — no labels, no headers."
    )

    print(f"\n⚡ Rewriting (temp={temperature})...")
    print("─" * 50)

    result = ""
    stream = ollama_lib.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": REWRITE_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        options={
            "temperature": temperature,
            "top_p": 0.92,
            "num_ctx": 8192,
            "repeat_penalty": 1.2,
        },
        stream=True,
    )

    for chunk in stream:
        token = chunk["message"]["content"]
        print(token, end="", flush=True)
        result += token

    print("\n" + "─" * 50)
    return result.strip()


# =========================
# STEP 3: FORMAT FOR TTS
# =========================

CUE_PATTERN = (
    r"\[(?:pause|long pause|dramatic pause|whisper|/whisper|loud|/loud|"
    r"speed up|/speed up|slow|/slow|gasp|sigh|laugh|sfx:[^\]]*)\]"
)


def format_for_tts(script):
    """
    Parse dramatic script into structured TTS-ready lines.
    Each line gets: index, raw text with cues, clean text, extracted cues.
    Standalone cue lines get attached to the previous spoken line.
    """
    lines = []
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


def estimate_duration(tts_lines, wpm=160):
    """Rough narration duration in seconds (words + pause cues)."""
    words = sum(len(l["text_clean"].split()) for l in tts_lines)
    base = (words / wpm) * 60

    pause_time = 0
    for l in tts_lines:
        for cue in l["cues"]:
            if "long pause" in cue or "dramatic pause" in cue:
                pause_time += 2.0
            elif "pause" in cue:
                pause_time += 0.8
            elif cue in ("[gasp]", "[sigh]", "[laugh]"):
                pause_time += 0.5

    return round(base + pause_time, 1)


# =========================
# STEP 4: GENERATE AUDIO (KOKORO)
# =========================

def generate_audio(tts_lines, dir_path, voice=None):
    """Generate audio from clean TTS lines using Kokoro."""

    if voice is None:
        voice = random.choice(KOKORO_VOICES)

    print(f"\n🔊 Step 4: Generating audio with Kokoro...")
    print(f"   Voice: {voice}")

    pipeline = KPipeline(lang_code="a")

    # Join clean lines into one text block
    full_text = "\n".join(l["text_clean"] for l in tts_lines)

    start = time.time()
    audio_chunks = []
    for _, _, audio in pipeline(full_text, voice=voice, speed=1, split_pattern=r'\n+'):
        audio_chunks.append(audio)

    full_audio = np.concatenate(audio_chunks)
    elapsed = time.time() - start

    out_path = os.path.join(dir_path, "04_narration.wav")
    sf.write(out_path, full_audio, 24000)

    duration = len(full_audio) / 24000
    print(f"   Duration: {int(duration // 60)}:{int(duration % 60):02d}")
    print(f"   Generated in {elapsed:.1f}s")

    # Save metadata
    meta = {
        "voice": voice,
        "duration_seconds": round(duration, 1),
        "generation_time_seconds": round(elapsed, 1),
        "sample_rate": 24000,
    }
    with open(os.path.join(dir_path, "04_audio_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return out_path, voice


# =========================
# STEP 5: WORD TIMESTAMPS
# =========================

def extract_word_timestamps(audio_path, model_size="base"):
    """Run faster-whisper on audio and return word-level timestamps."""

    print(f"\n🎯 Step 5: Extracting word timestamps...")
    print(f"   Model: {model_size}")

    start = time.time()
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, _ = model.transcribe(
        audio_path,
        word_timestamps=True,
        language="en",
    )

    words = []
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


def group_words_into_chunks(words, words_per_chunk=5):
    """Group words into display chunks of N words for subtitle display."""
    chunks = []
    for i in range(0, len(words), words_per_chunk):
        group = words[i:i + words_per_chunk]
        chunks.append({
            "index": len(chunks),
            "text": " ".join(w["word"] for w in group),
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "words": group,
        })
    return chunks


# =========================
# STEP 6: ASS SUBTITLE GENERATION
# =========================

def _ass_timestamp(seconds):
    """Convert seconds to ASS timestamp format H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_color(hex_rgb):
    """Convert #RRGGBB to ASS color &HBBGGRR& format."""
    r = hex_rgb[1:3]
    g = hex_rgb[3:5]
    b = hex_rgb[5:7]
    return f"&H{b}{g}{r}&"


# Style config — easy to tweak
SUB_FONT = "Arial"
SUB_FONTSIZE_NORMAL = 48
SUB_FONTSIZE_HIGHLIGHT = 58
SUB_COLOR_NORMAL = "#FFFFFF"      # white
SUB_COLOR_HIGHLIGHT = "#FFFF00"   # yellow
SUB_COLOR_OUTLINE = "#000000"     # black outline
SUB_OUTLINE_WIDTH = 3
SUB_MARGIN_BOTTOM = 60


def generate_ass_subtitles(chunks, output_path, video_width=1080, video_height=1920):
    """
    Generate an ASS subtitle file with word-by-word highlighting.

    For each word in each chunk, creates a dialogue line showing the full
    chunk text with the current word in yellow/bold/bigger and rest in white.
    """
    print(f"\n📝 Step 6: Generating ASS subtitles...")

    normal_color = _ass_color(SUB_COLOR_NORMAL)
    highlight_color = _ass_color(SUB_COLOR_HIGHLIGHT)
    outline_color = _ass_color(SUB_COLOR_OUTLINE)

    # ASS header
    header = f"""[Script Info]
Title: TikTok Narration Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{SUB_FONT},{SUB_FONTSIZE_NORMAL},{normal_color},&H000000FF&,{outline_color},&H80000000&,-1,0,0,0,100,100,0,0,1,{SUB_OUTLINE_WIDTH},0,2,40,40,{SUB_MARGIN_BOTTOM},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogue_lines = []

    for chunk in chunks:
        words = chunk["words"]

        for i, active_word in enumerate(words):
            # Build the line with current word highlighted
            parts = []
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
                    # Normal: white
                    parts.append(w["word"])

            text = " ".join(parts)
            start = _ass_timestamp(active_word["start"])
            end = _ass_timestamp(active_word["end"])

            dialogue_lines.append(
                f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}"
            )

    # Write ASS file
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header)
        for line in dialogue_lines:
            f.write(line + "\n")

    print(f"   Lines: {len(dialogue_lines)}")
    print(f"   ✅ Saved: {output_path}")

    return output_path


# =========================
# MAIN
# =========================

def main():
    setup_ollama()

    dir_path = os.path.join(ROOT_ASSETS_PATH, str(RUN_TIMESTAMP))
    os.makedirs(dir_path, exist_ok=True)

    content_path = os.path.join(dir_path, CONTENT_PATH)

    # Uncomment to fetch live from Reddit:
    rawContent = get_raw_content(REDDIT_SUBS)
    with open(content_path, "w", encoding="utf-8") as f:
        json.dump(rawContent, f, indent=2)

    # rawContent = {
    #     "subreddit": "r/TrueOffMyChest",
    #     "title": "My dad's best friend probably saved my life today and I'm so freaking grateful for it",
    #     "content": "Earlier today I was walking home from school when uncle George passed by in his car, he saw me and he told me to get in, he's not my biological uncle but he's my dad's childhood best friend and he's always been uncle for us, it was hot as fuck today so I got in.\n\nNow my house has two different entrances, one that i normally walk to and one that you drive to in the back, when we got to the back we found a white van parked outside and he told me to wait, none of my parent's cars were home and there were sounds coming from inside, I'm the youngest of my siblings and the only one living at home so honestly it was scary as fuck. Uncle George called the police while I called my dad, 10 minutes later which felt like an eternity the cops showed up and there were 4 guys inside the house and they were stealing, the van was full of our stuff, thankfully we got to keep everything but I was honestly still scared, they were all so much bigger than me, usually when im walking i have my earbuds on playing music so I wouldn't have noticed anything and would have walked straight to them and god knows what would have happened. \n\nI literally could have been raped or even killed if it wasn't for him. I kept thanking him over and over again and dad thanked him as well and he was like it's not a big deal.",
    #     "author": "Scary-Grapefruit-988",
    #     "url": "https://www.reddit.com/r/TrueOffMyChest/comments/1rzj2pc/my_dads_best_friend_probably_saved_my_life_today/",
    #     "score": 2125,
    # }

    title = rawContent["title"]
    body = rawContent["content"]

    print(f"\n📌 Post: {title}")
    print(f"   From: {rawContent['subreddit']} | ↑{rawContent['score']}")
    print(f"   Length: {len(body)} chars\n")

    # ── Step 1: Clean ──
    print("📝 Step 1: Cleaning...")
    cleaned = clean_text(body)
    print(
        f"   {len(body)} → {len(cleaned)} chars ({len(body) - len(cleaned)} removed)\n")

    with open(os.path.join(dir_path, "01_cleaned.txt"), "w", encoding="utf-8") as f:
        f.write(cleaned)

    # ── Step 2: Dramatic Rewrite ──
    dramatic = rewrite_dramatic(cleaned, title, temperature=0.9)

    with open(os.path.join(dir_path, "02_dramatic.txt"), "w", encoding="utf-8") as f:
        f.write(dramatic)

    # ── Step 3: Format for TTS ──
    print("\n🎙️  Step 3: Formatting for TTS...")
    tts_lines = format_for_tts(dramatic)
    duration = estimate_duration(tts_lines)
    word_count = sum(len(l["text_clean"].split()) for l in tts_lines)
    all_cues = [c for l in tts_lines for c in l["cues"]]

    print(f"   Lines:    {len(tts_lines)}")
    print(f"   Words:    {word_count}")
    print(f"   Duration: ~{int(duration // 60)}:{int(duration % 60):02d}")
    print(f"   Cues:     {len(all_cues)}")

    # RAW TTS LINES
    with open(os.path.join(dir_path, "03_tts_script_raw.txt"), "w", encoding="utf-8") as f:
        json.dump(tts_lines, f, indent=2)

    # Script with cues (for review / cue-aware TTS)
    with open(os.path.join(dir_path, "03_tts_script.txt"), "w", encoding="utf-8") as f:
        for l in tts_lines:
            f.write(l["text_with_cues"] + "\n")

    # Clean text only (for TTS models that don't understand cues)
    with open(os.path.join(dir_path, "03_tts_clean.txt"), "w", encoding="utf-8") as f:
        for l in tts_lines:
            f.write(l["text_clean"] + "\n")

    # Structured JSON (for programmatic TTS pipelines)
    with open(os.path.join(dir_path, "03_tts_data.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "title": title,
                "subreddit": rawContent["subreddit"],
                "total_lines": len(tts_lines),
                "word_count": word_count,
                "estimated_duration_seconds": duration,
                "lines": tts_lines,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    # ── Step 4: Generate Audio ──
    audio_path, voice_used = generate_audio(tts_lines, dir_path)

    # ── Step 5: Word Timestamps ──
    words = extract_word_timestamps(audio_path)
    chunks = group_words_into_chunks(words, words_per_chunk=5)
    print(f"   Chunks: {len(chunks)} (5 words each)")

    with open(os.path.join(dir_path, "05_word_timestamps.json"), "w", encoding="utf-8") as f:
        json.dump(words, f, indent=2)

    with open(os.path.join(dir_path, "05_subtitle_chunks.json"), "w", encoding="utf-8") as f:
        json.dump(chunks, f, indent=2)

    # ── Step 6: ASS Subtitles ──
    ass_9x16 = generate_ass_subtitles(
        chunks,
        os.path.join(dir_path, "06_subtitles_9x16.ass"),
        video_width=1080, video_height=1920,
    )
    ass_16x9 = generate_ass_subtitles(
        chunks,
        os.path.join(dir_path, "06_subtitles_16x9.ass"),
        video_width=1920, video_height=1080,
    )

    # ── Done ──
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


if __name__ == "__main__":
    main()

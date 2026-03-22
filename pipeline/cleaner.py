"""
Text cleaning for Reddit posts.

Strips Reddit-specific boilerplate (edits, updates, throwaway disclaimers),
removes Markdown formatting, and expands common abbreviations into their
spoken equivalents so TTS engines read them naturally.
"""

import re

# ── Patterns to remove outright ───────────────────────────────────────────────

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

# ── Abbreviation → spoken expansion ──────────────────────────────────────────

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


def clean_text(raw_text: str) -> str:
    """
    Strip Reddit formatting, boilerplate, and expand abbreviations.

    Parameters
    ----------
    raw_text : str
        The raw ``selftext`` body from a Reddit post.

    Returns
    -------
    str
        Cleaned, TTS-friendly plain text.
    """
    text = raw_text

    # Remove boilerplate / meta patterns
    for pattern in REMOVE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.DOTALL)

    # Strip Markdown formatting (keep inner text)
    text = re.sub(r"\*\*\*(.*?)\*\*\*", r"\1", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"\*(.*?)\*", r"\1", text)
    text = re.sub(r"~~(.*?)~~", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^>\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", text)
    text = re.sub(r"&amp;", "&", text)

    # Expand abbreviations
    for abbr, expansion in ABBREVIATIONS.items():
        text = re.sub(abbr, expansion, text)

    # Normalize whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)

    return text.strip()

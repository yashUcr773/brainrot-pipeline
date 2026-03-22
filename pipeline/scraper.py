"""
Reddit post scraping and selection.

Fetches top posts from a list of subreddits, filters for quality (length,
not stickied, has selftext), and returns the best candidate.
"""

import json
import os
import random

import requests

from pipeline.config import REDDIT_BASE_URL, ROOT_ASSETS_PATH


def get_raw_content(
    subs: list[str],
    *,
    min_length: int = 500,
    top_n: int = 3,
    time_filter: str = "day",
    limit_per_sub: int = 10,
) -> dict:
    """
    Scrape top posts from *subs* and return a single high-scoring candidate.

    Parameters
    ----------
    subs : list[str]
        Subreddit names (without the ``r/`` prefix).
    min_length : int
        Minimum selftext length in characters.
    top_n : int
        Pick randomly from the top-N scored posts.
    time_filter : str
        Reddit time window (``"day"``, ``"week"``, ``"month"``).
    limit_per_sub : int
        Number of posts to fetch per subreddit.

    Returns
    -------
    dict
        Keys: ``subreddit``, ``title``, ``content``, ``author``, ``url``, ``score``.
    """
    if not subs:
        raise ValueError("Subreddit list is empty")

    # Persist all raw posts for debugging / audit
    raw_dir = os.path.join(ROOT_ASSETS_PATH, "rawContent")
    os.makedirs(raw_dir, exist_ok=True)

    headers = {"User-Agent": "MyRedditApp/1.0"}
    responses = []
    for sub in subs:
        url = f"{REDDIT_BASE_URL}/r/{sub}/top.json"
        params = {"limit": limit_per_sub, "t": time_filter}
        res = requests.get(url, headers=headers, params=params)
        res.raise_for_status()
        responses.append(res.json())

    all_posts = []
    for res in responses:
        children = res.get("data", {}).get("children", [])
        all_posts.extend([c.get("data", {}) for c in children])

    with open(os.path.join(raw_dir, "allPosts.json"), "w", encoding="utf-8") as f:
        json.dump(all_posts, f, indent=2)

    # Filter: must have selftext, meet min length, not be stickied
    filtered_posts = [
        post
        for post in all_posts
        if post.get("selftext")
        and len(post.get("selftext", "")) >= min_length
        and not post.get("stickied", False)
    ]

    if not filtered_posts:
        raise ValueError("No suitable posts found after filtering")

    # Sort by score descending, pick randomly from top N
    filtered_posts.sort(key=lambda x: x.get("score", 0), reverse=True)
    candidates = filtered_posts[:top_n]
    best_post = random.choice(candidates)

    return {
        "subreddit": best_post.get("subreddit_name_prefixed"),
        "title": best_post.get("title"),
        "content": best_post.get("selftext"),
        "author": best_post.get("author"),
        "url": REDDIT_BASE_URL + best_post.get("permalink", ""),
        "score": best_post.get("score"),
    }

import { logger } from './logger.js';

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  subreddit: string;
  author: string;
  created_utc: number;
  stickied: boolean;
  over_18: boolean;
  _wordCount?: number;
  _qualityScore?: number;
}

export interface ScoringWeights {
  engagement: number; // upvotes, comments, ratio
  readability: number; // word count, sentence structure
  recency: number; // how fresh the post is
  titleQuality: number; // title engagement potential
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  engagement: 0.35,
  readability: 0.3,
  recency: 0.15,
  titleQuality: 0.2,
};

function wordCount(text: string): number {
  return (text || '').trim().match(/\S+/g)?.length || 0;
}

function sentenceCount(text: string): number {
  return (text || '').split(/[.!?]+/).filter(s => s.trim().length > 0).length;
}

function calculateEngagementScore(post: RedditPost): number {
  // Normalize score (log scale to handle viral posts)
  const scoreNorm = Math.min(1, Math.log10(post.score + 1) / 5);

  // Comment engagement
  const commentsNorm = Math.min(1, Math.log10(post.num_comments + 1) / 4);

  // Upvote ratio
  const ratioScore = post.upvote_ratio || 0.5;

  return (scoreNorm * 0.4 + commentsNorm * 0.3 + ratioScore * 0.3) * 100;
}

function calculateReadabilityScore(post: RedditPost): number {
  const words = wordCount(post.selftext || '');
  const sentences = sentenceCount(post.selftext || '');

  // Ideal range: 50-800 words
  let wordScore = 0;
  if (words < 20) {
    wordScore = 0;
  } else if (words >= 50 && words <= 800) {
    wordScore = 100;
  } else if (words < 50) {
    wordScore = ((words - 20) / 30) * 100;
  } else {
    // Penalize very long posts
    wordScore = Math.max(0, 100 - (words - 800) / 10);
  }

  // Average sentence length (ideal: 15-25 words)
  const avgSentenceLength = sentences > 0 ? words / sentences : 0;
  let sentenceScore = 0;
  if (avgSentenceLength >= 15 && avgSentenceLength <= 25) {
    sentenceScore = 100;
  } else if (avgSentenceLength < 15) {
    sentenceScore = (avgSentenceLength / 15) * 100;
  } else {
    sentenceScore = Math.max(0, 100 - (avgSentenceLength - 25) / 2);
  }

  return wordScore * 0.7 + sentenceScore * 0.3;
}

function calculateRecencyScore(post: RedditPost): number {
  const now = Date.now() / 1000;
  const ageHours = (now - post.created_utc) / 3600;

  // Prefer posts 2-24 hours old
  if (ageHours < 2) {
    return (ageHours / 2) * 100;
  } else if (ageHours <= 24) {
    return 100;
  } else {
    return Math.max(0, 100 - ((ageHours - 24) / 24) * 50);
  }
}

function calculateTitleQualityScore(post: RedditPost): number {
  const title = post.title || '';
  const titleWords = wordCount(title);

  // Ideal title length: 5-15 words
  let lengthScore = 0;
  if (titleWords >= 5 && titleWords <= 15) {
    lengthScore = 100;
  } else if (titleWords < 5) {
    lengthScore = (titleWords / 5) * 100;
  } else {
    lengthScore = Math.max(0, 100 - (titleWords - 15) * 5);
  }

  // Check for engaging patterns
  const hasQuestion = /\?/.test(title);
  const hasNumbers = /\d+/.test(title);
  const hasQuotes = /["']/.test(title);
  const engagementBonus = (hasQuestion ? 10 : 0) + (hasNumbers ? 5 : 0) + (hasQuotes ? 5 : 0);

  return Math.min(100, lengthScore * 0.8 + engagementBonus);
}

export function scorePost(post: RedditPost, weights: ScoringWeights = DEFAULT_WEIGHTS): number {
  const engagementScore = calculateEngagementScore(post);
  const readabilityScore = calculateReadabilityScore(post);
  const recencyScore = calculateRecencyScore(post);
  const titleScore = calculateTitleQualityScore(post);

  const totalScore =
    engagementScore * weights.engagement +
    readabilityScore * weights.readability +
    recencyScore * weights.recency +
    titleScore * weights.titleQuality;

  logger.debug(`Post ${post.id} scores`, {
    engagement: engagementScore.toFixed(1),
    readability: readabilityScore.toFixed(1),
    recency: recencyScore.toFixed(1),
    title: titleScore.toFixed(1),
    total: totalScore.toFixed(1),
  });

  return totalScore;
}

export function rankPosts(posts: RedditPost[]): RedditPost[] {
  const scored = posts.map(post => {
    post._qualityScore = scorePost(post);
    return post;
  });

  return scored.sort((a, b) => (b._qualityScore || 0) - (a._qualityScore || 0));
}

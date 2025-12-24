import path from 'path';
import { config as loadEnv } from 'dotenv';
import { logger } from './logger.js';

loadEnv();

export interface Config {
  reddit: {
    subreddits: string[];
    postLimit: number;
    timeFilter: 'day' | 'week' | 'month' | 'year' | 'all';
    minWords: number;
    maxWords: number;
  };
  video: {
    backgroundSubway: string;
    backgroundMinecraft: string;
    outputDir: string;
    fontPath: string;
    textSize: number;
    fps: number;
    resolution: { width: number; height: number };
  };
  openai: {
    enabled: boolean;
    apiKey: string;
    apiUrl: string;
    model: string;
    temperature: number;
    maxCharsPerChunk: number;
    maxTokens: number;
    maxRetries: number;
    baseDelayMs: number;
    maxBackoffMs: number;
    requestTimeoutMs: number;
    delayBetweenChunksMs: number;
  };
  elevenlabs: {
    apiKey: string;
    voiceId: string;
    model: string;
    stability: number;
    similarityBoost: number;
    maxCharsPerRequest: number;
  };
  rendering: {
    wordsPerPage: number;
    minPageDurationSec: number;
    defaultWpm: number; // words per minute for TTS estimation
  };
  cache: {
    enabled: boolean;
    historyFile: string;
    maxHistorySize: number;
  };
}

function validateConfig(config: Config): void {
  const errors: string[] = [];

  if (!config.elevenlabs.apiKey) {
    errors.push('ELEVENLABS_API_KEY is required');
  }
  if (!config.elevenlabs.voiceId) {
    errors.push('ELEVENLABS_VOICE_ID is required');
  }
  if (config.openai.enabled && !config.openai.apiKey) {
    logger.warn(
      'OpenAI is enabled but OPENAI_API_KEY is not set. Text improvement will be skipped.'
    );
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export function loadConfig(): Config {
  const config: Config = {
    reddit: {
      subreddits: [
        'pettyrevenge',
        'ProRevenge',
        'AmItheAsshole',
        'AmIOverreacting',
        'TrueOffMyChest',
        'offmychest',
        'raisedbynarcissists',
        'EntitledParents',
        'tifu',
        'maliciouscompliance',
        'BestOfRedditorUpdates',
        'TrueReddit',
        'UnresolvedMysteries',
      ],
      postLimit: parseInt(process.env.REDDIT_POST_LIMIT || '16'),
      timeFilter: (process.env.REDDIT_TIME_FILTER as any) || 'day',
      minWords: parseInt(process.env.REDDIT_MIN_WORDS || '20'),
      maxWords: parseInt(process.env.REDDIT_MAX_WORDS || '1500'),
    },
    video: {
      backgroundSubway: path.resolve(process.env.BACKGROUND_SUBWAY || '../videos/subway-surfer/'),
      backgroundMinecraft: path.resolve(process.env.BACKGROUND_MINECRAFT || '../videos/minecraft/'),
      outputDir: path.resolve(process.env.OUTPUT_DIR || 'output'),
      fontPath: path.resolve(process.env.FONT_PATH || '../font/Comic-Sans-MS/Comic-Sans-MS.ttf'),
      textSize: parseInt(process.env.TEXT_SIZE || '72'),
      fps: parseInt(process.env.VIDEO_FPS || '30'),
      resolution: {
        width: parseInt(process.env.VIDEO_WIDTH || '1080'),
        height: parseInt(process.env.VIDEO_HEIGHT || '1920'),
      },
    },
    openai: {
      enabled: process.env.OPENAI_ENABLED !== 'false',
      apiKey: process.env.OPENAI_API_KEY || '',
      apiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
      maxCharsPerChunk: parseInt(process.env.OPENAI_MAX_CHARS_PER_CHUNK || '3000'),
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '1400'),
      maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES || '6'),
      baseDelayMs: parseInt(process.env.OPENAI_BASE_DELAY_MS || '800'),
      maxBackoffMs: parseInt(process.env.OPENAI_MAX_BACKOFF_MS || '20000'),
      requestTimeoutMs: parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS || '180000'),
      delayBetweenChunksMs: parseInt(process.env.OPENAI_DELAY_BETWEEN_CHUNKS_MS || '450'),
    },
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY || '',
      voiceId: process.env.ELEVENLABS_VOICE_ID || '',
      model: process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2',
      stability: parseFloat(process.env.ELEVENLABS_STABILITY || '0.5'),
      similarityBoost: parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST || '0.8'),
      maxCharsPerRequest: parseInt(process.env.ELEVENLABS_MAX_CHARS || '2500'),
    },
    rendering: {
      wordsPerPage: parseInt(process.env.WORDS_PER_PAGE || '6'),
      minPageDurationSec: parseFloat(process.env.MIN_PAGE_DURATION_SEC || '0.7'),
      defaultWpm: parseInt(process.env.DEFAULT_WPM || '170'),
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      historyFile: path.resolve(process.env.CACHE_HISTORY_FILE || 'cache/post_history.json'),
      maxHistorySize: parseInt(process.env.CACHE_MAX_HISTORY || '1000'),
    },
  };

  // validateConfig(config);
  return config;
}

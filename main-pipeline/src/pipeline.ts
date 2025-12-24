// Pipeline utility functions
import { spawnSync } from 'child_process';
import path from 'path';
import { Readable } from 'stream';
import fs from 'fs-extra';
import axios from 'axios';
import wrapAnsi from 'wrap-ansi';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { logger } from './logger.js';
import { rankPosts, type RedditPost } from './scorer.js';
import { VideoEffectsManager } from './effects.js';
import type { Config } from './config.js';
import type { CacheManager } from './cache.js';

const FFPROBE = ffprobeStatic.path;
// Workaround for ffmpeg-static TypeScript types
const ffmpeg = ffmpegPath as unknown as string;

// ============= Reddit Fetching =============

export async function pickBackgroundForToday(
  config: Config,
  cacheManager: CacheManager
): Promise<string> {
  const cachedBG = cacheManager.get('bg');
  if (cachedBG) return cachedBG;

  const videos = [];
  const sourceFolders = [config.video.backgroundMinecraft, config.video.backgroundSubway];

  for (const sourceFolder of sourceFolders) {
    if (!fs.existsSync(sourceFolder)) {
      logger.warn(`Background folder not found: ${sourceFolder}`);
      continue;
    }
    const res = fs.readdirSync(sourceFolder).filter(f => !f.startsWith('.'));
    videos.push(...res.map(v => path.join(sourceFolder, v)));
  }

  if (videos.length === 0) {
    throw new Error('No background videos found in configured folders');
  }

  const selected = videos[Math.floor(Math.random() * videos.length)];
  logger.debug(`Selected background: ${selected}`);
  cacheManager.set('bg', selected);
  await cacheManager.saveData();
  return selected!;
}

async function fetchTopPostsFrom(subreddit: string, config: Config): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=${config.reddit.timeFilter}&limit=${config.reddit.postLimit}`;
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'brainrot-reels-bot/2.0' },
      timeout: 10000,
    });
    if (!resp.data || !resp.data.data) return [];
    return resp.data.data.children.map((c: any) => c.data);
  } catch (error: any) {
    logger.error(`Failed to fetch from r/${subreddit}`, { error: error?.message });
    return [];
  }
}

function wordCount(s = ''): number {
  return (s || '').trim().match(/\S+/g)?.length || 0;
}

export async function fetchCandidatePost(
  config: Config,
  cacheManager: CacheManager
): Promise<RedditPost> {
  const cachedPost = cacheManager.get('post');
  if (cachedPost) return cachedPost;

  let all: RedditPost[] = [];
  logger.info(`Fetching posts from ${config.reddit.subreddits.length} subreddits...`);

  for (const sr of config.reddit.subreddits) {
    const posts = await fetchTopPostsFrom(sr, config);
    all = all.concat(posts);
  }

  // Filter unsuitable posts
  all = all.filter(p => {
    if (!p || p.stickied || p.over_18 || !p.title) return false;
    if (config.cache.enabled && cacheManager.hasProcessed(p.id)) {
      logger.debug(`Post ${p.id} already processed, skipping`);
      return false;
    }
    return true;
  });

  if (all.length === 0) {
    throw new Error('No suitable reddit posts found');
  }

  // Calculate word counts
  for (const p of all) {
    p._wordCount = wordCount((p.selftext || '') + ' ' + (p.title || ''));
  }

  // Filter by word count
  const candidates = all.filter(p => {
    const wc = p._wordCount || 0;
    return wc >= config.reddit.minWords && wc <= config.reddit.maxWords;
  });

  const pool = candidates.length ? candidates : all;
  logger.info(`Found ${pool.length} candidate posts`);

  // Rank posts by quality score
  const ranked = rankPosts(pool);
  const best = ranked[0];

  if (!best) {
    throw new Error('No posts available after ranking');
  }

  logger.info(
    `Selected: "${best.title.slice(0, 60)}..." (score: ${best._qualityScore?.toFixed(1)})`
  );

  cacheManager.set('post', best);
  await cacheManager.saveData();
  return best;
}

// ============= Text Processing =============

function cleanPost(raw: string): string {
  if (!raw) return '';
  let t = String(raw);
  t = t.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  t = t.replace(/>!(.*?)!</gs, '$1');
  t = t.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
  t = t.replace(/\bhttps?:\/\/\S+\b/g, '').replace(/\bwww\.\S+\b/g, '');
  t = t.replace(/\[[^\]]*\]/g, '');

  const metaPatterns = [
    /^original post/i,
    /^editor/i,
    /click here/i,
    /transcription/i,
    /imgur/i,
    /^do not comment/i,
  ];

  t = t
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      for (const pat of metaPatterns) if (pat.test(trimmed)) return '';
      return trimmed;
    })
    .join('\n');

  t = t
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*>\s?/, ''))
    .join('\n');
  t = t
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.trim().replace(/[^\S\r\n]+/g, ' ');
  return t;
}

export async function buildOverlayLines(
  title: string,
  selftext: string,
  subreddit: string,
  author: string,
  cacheManager: CacheManager
): Promise<string> {
  const overlay = cacheManager.get('overlay');
  if (overlay) return overlay;

  const plainTitle = cleanPost(title || '');
  const plainBody = cleanPost(selftext || '');
  const attribution = `— r/${subreddit} • u/${author || 'unknown'}`;
  const approxChars = 48;
  const wrappedTitle = wrapAnsi(plainTitle, approxChars, { hard: true });
  const wrappedBody = plainBody ? wrapAnsi(plainBody, approxChars, { hard: true }) : '';
  const wrappedAttrib = wrapAnsi(attribution, approxChars, { hard: true });
  const generatedOverlay = wrappedBody
    ? `${wrappedTitle}\n\n${wrappedBody}\n\n${wrappedAttrib}`
    : `${wrappedTitle}\n\n${wrappedAttrib}`;

  cacheManager.set('overlay', generatedOverlay);
  await cacheManager.saveData();
  return generatedOverlay;
}

// ============= OpenAI Text Improvement =============

function chunkTextByParagraphs(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\r?\n\r?\n/)
    .map(p => p.trim())
    .filter(Boolean);
  const chunks = [];
  let current: string[] = [],
    curLen = 0;

  for (const p of paragraphs) {
    const len = p.length + 2;
    if (curLen + len > maxChars && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [p];
      curLen = len;
    } else {
      current.push(p);
      curLen += len;
    }
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function callOpenAIChatWithRetry(messages: any[], config: Config): Promise<string> {
  const key = config.openai.apiKey;
  if (!key) throw new Error('OPENAI_API_KEY is not set');

  let attempt = 0;
  while (attempt < config.openai.maxRetries) {
    attempt++;
    try {
      const resp = await axios.post(
        config.openai.apiUrl,
        {
          model: config.openai.model,
          messages,
          temperature: config.openai.temperature,
          max_tokens: config.openai.maxTokens,
        },
        {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: config.openai.requestTimeoutMs,
        }
      );
      const choice = resp.data?.choices?.[0];
      if (!choice) throw new Error('No response from OpenAI');
      return (choice.message?.content ?? '').trim();
    } catch (err: any) {
      const status = err?.response?.status;
      const isRetry = status === 429 || (status >= 500 && status < 600) || !err?.response;
      if (!isRetry) {
        throw new Error(
          'OpenAI error: ' + (err?.response?.data ? JSON.stringify(err.response.data) : err.message)
        );
      }
      if (attempt >= config.openai.maxRetries) throw err;
      const expo = Math.min(
        config.openai.baseDelayMs * Math.pow(2, attempt - 1),
        config.openai.maxBackoffMs
      );
      const jitter = Math.floor(Math.random() * Math.min(1000, expo * 0.5));
      await sleep(expo + jitter);
      logger.debug(`OpenAI retry ${attempt}/${config.openai.maxRetries}`);
    }
  }
  throw new Error('OpenAI exhausted retries');
}

async function improveChunkResilient(chunkText: string, config: Config): Promise<string> {
  try {
    const systemPrompt = `You are a professional editor. Improve Reddit post text for clarity, flow, grammar and engagement while preserving meaning. Rules: DO NOT invent facts. Keep trigger warnings unchanged. Remove raw URLs/editorial lines. Return ONLY improved plain text.`;
    const userPrompt = `Improve the following text chunk. Preserve meaning and trigger warnings.\n\n---\n${chunkText}\n\n---\nReturn only the improved text.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    return await callOpenAIChatWithRetry(messages, config);
  } catch (e: any) {
    logger.warn('OpenAI failed for chunk, returning original', { error: e?.message });
    return chunkText;
  }
}

export async function improvePostText(
  title: string,
  body: string,
  config: Config,
  cacheManager: CacheManager
): Promise<string> {
  const cachedPost = cacheManager.get('improved_post');

  if (cachedPost) return cachedPost;

  if (!config.openai.enabled || !config.openai.apiKey) {
    logger.info('OpenAI disabled or no API key, using cleaned text');
    return cleanPost(body);
  }

  const lines = (body || '').replace(/\r\n?/g, '\n').split('\n');
  let twBlock = '',
    idx = 0;

  while (idx < lines.length && (lines[idx]?.trim() || '') === '') idx++;
  const twRegex = /^\s*(TW|TW:|Trigger warning|Trigger Warning|tw:)/i;

  if (idx < lines.length && lines[idx] && twRegex.test(lines[idx]!)) {
    const collected = [];
    while (idx < lines.length && (lines[idx]?.trim() || '') !== '') {
      collected.push(lines[idx]);
      idx++;
    }
    twBlock = collected.join('\n').trim();
  } else {
    idx = 0;
  }

  const remainder = lines.slice(idx).join('\n').trim();
  const cleanedRemainder = cleanPost(remainder);

  logger.info('Improving text with OpenAI...');
  const chunks = chunkTextByParagraphs(cleanedRemainder, config.openai.maxCharsPerChunk);
  const improvedChunks = [];

  for (let i = 0; i < chunks.length; ++i) {
    const chunk = chunks[i];
    if (chunk) {
      improvedChunks.push(await improveChunkResilient(chunk, config));
    }
    if (i < chunks.length - 1) await sleep(config.openai.delayBetweenChunksMs);
  }

  const improvedPost = (twBlock ? twBlock + '\n\n' : '') + improvedChunks.join('\n\n').trim();
  cacheManager.set('improved_post', improvedPost);
  await cacheManager.saveData();
  return improvedPost;
}

// ============= TTS Generation =============

async function callElevenLabsTTS(text: string, outPath: string, config: Config): Promise<string> {
  const client = new ElevenLabsClient({ apiKey: config.elevenlabs.apiKey });

  try {
    const audioStream = await client.textToSpeech.convert(config.elevenlabs.voiceId, {
      modelId: config.elevenlabs.model,
      text,
      voiceSettings: {
        stability: config.elevenlabs.stability,
        similarityBoost: config.elevenlabs.similarityBoost,
      },
    });

    const nodeStream = Readable.fromWeb(audioStream as any);
    const writeStream = fs.createWriteStream(outPath);

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
      nodeStream.on('error', reject);
    });

    return outPath;
  } catch (err: any) {
    const msg = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message || String(err);
    throw new Error('ElevenLabs TTS failed: ' + msg);
  }
}

export async function buildTTSForText(
  text: string,
  config: Config,
  cacheManager: CacheManager
): Promise<string> {
  const cachedTTSText = cacheManager.get('cachedTTSText');
  if (cachedTTSText) {
    return cachedTTSText;
  }

  const tmpDir = path.join(process.cwd(), 'tmp_texts');
  await fs.ensureDir(tmpDir);
  const targetPath = path.join(tmpDir, `tts_${Date.now()}.mp3`);

  if (text.length <= config.elevenlabs.maxCharsPerRequest) {
    const TTSpath = await callElevenLabsTTS(text, targetPath, config);
    cacheManager.set('cachedTTSText', TTSpath);
    await cacheManager.saveData();
    return TTSpath;
  }

  // Chunk and concatenate
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
  const audioPieces = [];
  let idx = 0;

  for (const p of paragraphs) {
    const chunk =
      p.length > config.elevenlabs.maxCharsPerRequest
        ? p.slice(0, config.elevenlabs.maxCharsPerRequest)
        : p;
    const piecePath = path.join(tmpDir, `tts_piece_${Date.now()}_${idx}.mp3`);

    try {
      await callElevenLabsTTS(chunk, piecePath, config);
      audioPieces.push(piecePath);
      idx++;
    } catch (e: any) {
      logger.warn('TTS chunk failed, skipping', { error: e?.message });
    }
    await sleep(200);
  }

  if (audioPieces.length === 0) {
    throw new Error('Failed to generate any TTS audio pieces');
  }

  // Concatenate pieces
  const listPath = path.join(tmpDir, `tts_concat_${Date.now()}.txt`);
  const listContent = audioPieces.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, listContent, 'utf8');

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', targetPath];
  const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  if (proc.error || proc.status !== 0) {
    throw new Error(`ffmpeg concat failed: ${proc.stderr}`);
  }

  // Cleanup
  fs.removeSync(listPath);
  for (const p of audioPieces) fs.removeSync(p);
  cacheManager.set('cachedTTSText', targetPath);
  await cacheManager.saveData();
  return targetPath;
}

// ============= Video Rendering =============

function probeDurationSeconds(filePath: string): number {
  if (!fs.pathExistsSync(filePath)) throw new Error('File not found: ' + filePath);

  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ];

  const proc = spawnSync(FFPROBE, args, { encoding: 'utf8' });
  if (proc.status !== 0) throw new Error('ffprobe failed: ' + proc.stderr);

  const out = (proc.stdout || '').trim();
  const v = parseFloat(out);
  if (isNaN(v)) throw new Error('Could not parse duration: ' + out);
  return v;
}

function paginateByWords(text: string, wordsPerPage: number): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const pages = [];
  for (let i = 0; i < words.length; i += wordsPerPage) {
    pages.push(words.slice(i, i + wordsPerPage).join(' '));
  }
  if (pages.length === 0) pages.push('');
  return pages;
}

function secsToAssTime(s: number): string {
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  s -= minutes * 60;
  const seconds = Math.floor(s);
  const centis = Math.floor((s - seconds) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    centis
  ).padStart(2, '0')}`;
}

export async function renderWithAudio(
  bgPath: string,
  overlayText: string,
  outPath: string,
  audioPath: string,
  config: Config
): Promise<string> {
  const tmpDir = path.join(process.cwd(), 'tmp_texts');
  await fs.ensureDir(tmpDir);

  // Extract TW block
  const linesAll = overlayText.replace(/\r\n?/g, '\n').split('\n');
  let twBlock = '',
    startIdx = 0;

  while (startIdx < linesAll.length && (linesAll[startIdx]?.trim() || '') === '') startIdx++;
  const twRegex = /^\s*(TW|TW:|Trigger warning|Trigger Warning|tw:)/i;

  if (startIdx < linesAll.length && linesAll[startIdx] && twRegex.test(linesAll[startIdx]!)) {
    const collected = [];
    while (startIdx < linesAll.length && (linesAll[startIdx]?.trim() || '') !== '') {
      collected.push(linesAll[startIdx]);
      startIdx++;
    }
    twBlock = collected.join(' ').trim();
  }

  const bodyForPages = (twBlock ? linesAll.slice(startIdx).join('\n') : overlayText).trim();
  const pagesByWords = paginateByWords(bodyForPages, config.rendering.wordsPerPage);
  const pages = twBlock ? [twBlock, ...pagesByWords] : pagesByWords;

  // Get audio duration
  const audioDur = probeDurationSeconds(audioPath);
  const dur = Math.max(0.5, audioDur + 0.25);

  // Calculate page timing
  const totalPages = Math.max(1, pages.length);
  let perPage = dur / totalPages;
  if (perPage < config.rendering.minPageDurationSec) {
    const maxPagesFit = Math.floor(dur / config.rendering.minPageDurationSec) || 1;
    if (maxPagesFit < totalPages) pages.length = maxPagesFit;
    perPage = Math.max(config.rendering.minPageDurationSec, dur / pages.length);
  }

  // Build ASS file
  const FONTNAME = path.basename(config.video.fontPath);
  const ass = [];
  ass.push('[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '');
  ass.push('[V4+ Styles]');
  ass.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  );
  ass.push(
    `Style: Default,${FONTNAME},${config.video.textSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,2,8,10,10,200,1`
  );
  ass.push(
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  );

  let cursor = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = String(pages[i] || '').trim();
    const wrapped = wrapAnsi(p, 36, { hard: true });
    const escaped = wrapped.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    const start = secsToAssTime(cursor);
    const end = secsToAssTime(cursor + perPage);
    ass.push(`Dialogue: 0,${start},${end},Default,,0,0,200,,${escaped}`);
    cursor += perPage;
    if (cursor >= dur - 1e-6) break;
  }

  const assBody = ass.join('\n');
  const assPath = path.join(tmpDir, `continuous-${Date.now()}.ass`);
  await fs.writeFile(assPath, assBody, 'utf8');

  // Video processing
  const effectsManager = new VideoEffectsManager(config);
  const fontsDir = path.dirname(config.video.fontPath);

  // Use advanced filter with zoom effects
  const vf = effectsManager.createSimpleFilter(assPath, fontsDir);

  // Get background duration
  let bgDuration = null;
  try {
    bgDuration = probeDurationSeconds(bgPath);
  } catch (e: any) {
    logger.warn('Background probe failed', { error: e?.message });
  }

  let startOffset = 0;
  const useLoop = !(bgDuration && bgDuration > dur);

  if (bgDuration && bgDuration > dur) {
    const maxStart = Math.max(0, bgDuration - dur);
    startOffset = Math.floor(Math.random() * maxStart * 100) / 100;
  }

  // Build FFmpeg command
  const args = ['-y'];
  if (startOffset > 0) args.push('-ss', String(startOffset));
  args.push('-i', bgPath);
  args.push('-i', audioPath);
  args.push('-vf', vf);
  args.push('-t', String(Math.max(0.5, dur)));
  args.push('-map', '0:v', '-map', '1:a');
  args.push('-shortest');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '128k');
  args.push(outPath);

  logger.info(`Rendering video (duration: ${dur.toFixed(2)}s)`);
  const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  fs.removeSync(assPath);

  if (proc.error || proc.status !== 0) {
    throw new Error(`FFmpeg failed: ${proc.stderr}`);
  }

  return outPath;
}

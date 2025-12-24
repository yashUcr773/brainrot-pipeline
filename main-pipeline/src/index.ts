// Enhanced Brainrot Video Pipeline
// Features: AI post selection, caching, metrics, video effects, audio enhancements
import { spawnSync } from 'child_process';
import path from 'path';
import { Readable } from 'stream';
import fs from 'fs-extra';
import axios from 'axios';
import wrapAnsi from 'wrap-ansi';
import ffmpeg from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { logger } from './logger.js';
import { loadConfig, type Config } from './config.js';
import { CacheManager } from './cache.js';
import { MetricsTracker } from './metrics.js';
import { rankPosts, type RedditPost } from './scorer.js';
import { VideoEffectsManager } from './effects.js';

const FFPROBE = ffprobeStatic.path;
const config = loadConfig();

// Initialize managers
const cacheManager = new CacheManager(config);
const metricsTracker = new MetricsTracker();
const effectsManager = new VideoEffectsManager(config);

// ====== end CONFIG ======

await fs.ensureDir(config.video.outputDir);
await cacheManager.initialize();
await metricsTracker.load();

// ----------------- Utilities -----------------
function pickBackgroundForToday() {
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
  return selected;
}

async function fetchTopPostsFrom(subreddit: string, limit = 8, t = 'day'): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=${t}&limit=${limit}`;
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'brainrot-reels-bot/2.0' },
      timeout: 10000
    });
    if (!resp.data || !resp.data.data) return [];
    return resp.data.data.children.map((c: any) => c.data);
  } catch (error) {
    logger.error(`Failed to fetch from r/${subreddit}`, { error });
    return [];
  }
}

function wordCount(s = '') {
  return (s || '').trim().match(/\S+/g)?.length || 0;
}

async function fetchCandidatePost() {
  let all: RedditPost[] = [];
  logger.info(`Fetching posts from ${config.reddit.subreddits.length} subreddits...`);

  for (const sr of config.reddit.subreddits) {
    try {
      const posts = await fetchTopPostsFrom(sr, config.reddit.postLimit, config.reddit.timeFilter);
      all = all.concat(posts);
    } catch (e: any) {
      logger.warn(`Failed to fetch r/${sr}`, { error: e?.message || e });
    }
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

  logger.info(`Selected: "${best.title.slice(0, 60)}..." (score: ${best._qualityScore?.toFixed(1)})`);
  return best;
}

// ----------------- cleaning helpers -----------------
function cleanPost(raw) {
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

function buildOverlayLines(title, selftext, subreddit, author) {
  const plainTitle = cleanPost(title || '');
  const plainBody = cleanPost(selftext || '');
  const attribution = `— r/${subreddit} • u/${author || 'unknown'}`;
  const approxChars = 48;
  const wrappedTitle = wrapAnsi(plainTitle, approxChars, { hard: true });
  const wrappedBody = plainBody ? wrapAnsi(plainBody, approxChars, { hard: true }) : '';
  const wrappedAttrib = wrapAnsi(attribution, approxChars, { hard: true });
  return wrappedBody
    ? `${wrappedTitle}\n\n${wrappedBody}\n\n${wrappedAttrib}`
    : `${wrappedTitle}\n\n${wrappedAttrib}`;
}

// ----------------- OpenAI chunking + resilient calling (optional) -----------------
function chunkTextByParagraphs(text, maxChars = MAX_CHARS_PER_CHUNK) {
  const paragraphs = text
    .split(/\r?\n\r?\n/)
    .map(p => p.trim())
    .filter(Boolean);
  const chunks = [];
  let current = [],
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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function callOpenAIChatWithRetry(
  messages: any[],
  model = config.openai.model,
  temperature = config.openai.temperature
) {
  const key = config.openai.apiKey;
  if (!key) throw new Error('OPENAI_API_KEY is not set in environment');

  let attempt = 0;
  while (attempt < config.openai.maxRetries) {
    attempt++;
    try {
      const resp = await axios.post(
        config.openai.apiUrl,
        { model, messages, temperature, max_tokens: config.openai.maxTokens },
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
      const expo = Math.min(config.openai.baseDelayMs * Math.pow(2, attempt - 1), config.openai.maxBackoffMs);
      const jitter = Math.floor(Math.random() * Math.min(1000, expo * 0.5));
      await sleep(expo + jitter);
      logger.debug(`OpenAI retry ${attempt}/${config.openai.maxRetries}`);
    }
  }
  throw new Error('OpenAI exhausted retries');
}
  let attempt = 0;
  while (attempt < OPENAI_MAX_RETRIES) {
    attempt++;
    try {
      const resp = await axios.post(
        OPENAI_API_URL,
        { model, messages, temperature, max_tokens: MAX_OPENAI_TOKENS },
        {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: OPENAI_REQUEST_TIMEOUT_MS,
        }
      );
      const choice = resp.data?.choices?.[0];
      if (!choice) throw new Error('No response from OpenAI');
      return (choice.message?.content ?? '').trim();
    } catch (err) {
      const status = err?.response?.status;
      const isRetry = status === 429 || (status >= 500 && status < 600) || !err?.response;
      if (!isRetry)
        throw new Error(
          'OpenAI error: ' + (err?.response?.data ? JSON.stringify(err.response.data) : err.message)
        );
      if (attempt >= OPENAI_MAX_RETRIES) throw err;
      const expo = Math.min(OPENAI_BASE_DELAY_MS * Math.pow(2, attempt - 1), OPENAI_MAX_BACKOFF_MS);
      const jitter = Math.floor(Math.random() * Math.min(1000, expo * 0.5));
      await sleep(expo + jitter);
    }
  }
  throw new Error('OpenAI exhausted retries');
}

async function improveChunkResilient(chunkText, options = {}) {
  try {
    const systemPrompt = `You are a professional editor. Improve Reddit post text for clarity, flow, grammar and engagement while preserving meaning. Rules: DO NOT invent facts. Keep trigger warnings unchanged. Remove raw URLs/editorial lines. Return ONLY improved plain text.`;
    const userPrompt = `Improve the following text chunk. Preserve meaning and trigger warnings.\n\n---\n${chunkText}\n\n---\nReturn only the improved text.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    return await callOpenAIChatWithRetry(messages, options.model, options.temperature);
  } catch (e) {
    console.warn('OpenAI failed for chunk, returning original chunk:', e?.message || e);
    return chunkText;
  }
}

async function improvePostText(title, body, opts = {}) {
  const lines = (body || '').replace(/\r\n?/g, '\n').split('\n');
  let twBlock = '',
    idx = 0;
  while (idx < lines.length && lines[idx].trim() === '') idx++;
  const twRegex = /^\s*(TW|TW:|Trigger warning|Trigger Warning|tw:)/i;
  if (idx < lines.length && twRegex.test(lines[idx])) {
    const collected = [];
    while (idx < lines.length && lines[idx].trim() !== '') {
      collected.push(lines[idx]);
      idx++;
    }
    twBlock = collected.join('\n').trim();
  } else idx = 0;
  const remainder = lines.slice(idx).join('\n').trim();

  function basicClean(s) {
    let t = s || '';
    t = t.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    t = t.replace(/>!(.*?)!</gs, '$1');
    t = t.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
    t = t.replace(/\bhttps?:\/\/\S+\b/g, '').replace(/\bwww\.\S+\b/g, '');
    t = t.replace(/\[[^\]]*\]/g, '');
    t = t
      .split(/\r?\n/)
      .map(line => {
        const trim = line.trim();
        const metaPat =
          /^(editor|original post|click here|transcription|imgur|do not comment|please see|links below)/i;
        if (metaPat.test(trim)) return '';
        return trim;
      })
      .join('\n');
    t = t.replace(/^\s*>+\s?/gm, '');
    t = t
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1');
    return t.replace(/\n{3,}/g, '\n\n').trim();
  }

  const cleanedRemainder = basicClean(remainder);
  if (!process.env.OPENAI_API_KEY) return (twBlock ? twBlock + '\n\n' : '') + cleanedRemainder;
  const chunks = chunkTextByParagraphs(cleanedRemainder, MAX_CHARS_PER_CHUNK);
  const improvedChunks = [];
  for (let i = 0; i < chunks.length; ++i) {
    improvedChunks.push(await improveChunkResilient(chunks[i], { tone: opts.tone }));
    if (i < chunks.length - 1) await sleep(DELAY_BETWEEN_CHUNKS_MS);
  }
  return (twBlock ? twBlock + '\n\n' : '') + improvedChunks.join('\n\n').trim();
}

// ----------------- ElevenLabs TTS helpers -----------------
async function callElevenLabsTTS(
  text,
  outPath,
  voiceId = ELEVENLABS_VOICE_ID,
  key = ELEVENLABS_API_KEY
) {
  if (!key) throw new Error('ELEVENLABS_API_KEY not set in env');
  if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID not set in env');

  const client = new ElevenLabsClient({ apiKey: key });

  console.log('🚀 ~ callElevenLabsTTS ~ text:', text);
  try {
    const audioStream = await client.textToSpeech.convert(voiceId, {
      modelId: 'eleven_turbo_v2',
      text,
      voiceSettings: { stability: 0.4, similarityBoost: 0.9 },
    });

    // audioStream is a WHATWG ReadableStream — convert to Node Readable
    const nodeStream = Readable.fromWeb(audioStream);

    const writeStream = fs.createWriteStream(outPath);
    await new Promise((resolve, reject) => {
      nodeStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      nodeStream.on('error', reject);
    });

    return outPath;
  } catch (err) {
    const msg = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message || String(err);
    throw new Error('ElevenLabs SDK TTS failed: ' + msg);
  }
}

// If needed: chunk and stitch ElevenLabs audio (basic approach)
async function buildTTSForText(text, targetPath) {
  // If text small, do a single request
  const MAX_SINGLE = 2500; // chars safe-ish – adjust if you hit problems
  if (text.length <= MAX_SINGLE) {
    return await callElevenLabsTTS(text, targetPath);
  }
  // chunk by sentences/paragraphs to avoid large requests; then concatenate using ffmpeg concat
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
  const tmpDir = path.join(process.cwd(), 'tmp_texts');
  await fs.ensureDir(tmpDir);
  const audioPieces = [];
  let idx = 0;
  for (const p of paragraphs) {
    const chunk = p.length > MAX_SINGLE ? p.slice(0, MAX_SINGLE) : p;
    const piecePath = path.join(tmpDir, `tts_piece_${Date.now()}_${idx}.mp3`);
    try {
      await callElevenLabsTTS(chunk, piecePath);
      audioPieces.push(piecePath);
      idx++;
    } catch (e) {
      // On failure, fallback: write silence or skip
      console.warn('TTS chunk failed, skipping chunk:', e?.message || e);
    }
    await sleep(200); // gentle throttle
  }
  if (audioPieces.length === 0) throw new Error('Failed to generate any TTS audio pieces');

  // create concat list
  const listPath = path.join(tmpDir, `tts_concat_${Date.now()}.txt`);
  const listContent = audioPieces.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, listContent, 'utf8');
  // produce targetPath via ffmpeg concat
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', targetPath];
  const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (proc.error || proc.status !== 0) {
    const stderr = proc.stderr ? String(proc.stderr) : '';
    const stdout = proc.stdout ? String(proc.stdout) : '';
    throw new Error(`ffmpeg concat failed when assembling TTS: stdout:${stdout}\nstderr:${stderr}`);
  }
  // cleanup pieces & list
  try {
    fs.removeSync(listPath);
  } catch (e) {}
  for (const p of audioPieces)
    try {
      fs.removeSync(p);
    } catch (e) {}
  return targetPath;
}

// ----------------- ffprobe helper -----------------
function probeDurationSeconds(filePath) {
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

// ----------------- ASS rendering + audio mixing -----------------
function escapeForSubFilter(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
function ensureExistsSync(p, name = 'file') {
  if (!fs.pathExistsSync(p)) throw new Error(`${name} not found: ${p}`);
}
function paginateByWords(text, wordsPerPage = WORDS_PER_PAGE) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const pages = [];
  for (let i = 0; i < words.length; i += wordsPerPage)
    pages.push(words.slice(i, i + wordsPerPage).join(' '));
  if (pages.length === 0) pages.push('');
  return pages;
}

function secsToAssTime(s) {
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

async function renderWithAudio(bgPath, overlayText, outPath, fontPath, audioPath, opts = {}) {
  const { durationSeconds = 30, streamLoop = true } = opts;
  ensureExistsSync(bgPath, 'Background');
  ensureExistsSync(fontPath, 'Font');
  ensureExistsSync(audioPath, 'Audio');
  await fs.ensureDir(path.dirname(outPath));
  const tmpDir = path.join(process.cwd(), 'tmp_texts');
  await fs.ensureDir(tmpDir);

  // Prepare pages (preserve TW block)
  const linesAll = overlayText.replace(/\r\n?/g, '\n').split('\n');
  let twBlock = '',
    startIdx = 0;
  while (startIdx < linesAll.length && linesAll[startIdx].trim() === '') startIdx++;
  const twRegex = /^\s*(TW|TW:|Trigger warning|Trigger Warning|tw:)/i;
  if (startIdx < linesAll.length && twRegex.test(linesAll[startIdx])) {
    const collected = [];
    while (startIdx < linesAll.length && linesAll[startIdx].trim() !== '') {
      collected.push(linesAll[startIdx]);
      startIdx++;
    }
    twBlock = collected.join(' ').trim();
  }
  const bodyForPages = (twBlock ? linesAll.slice(startIdx).join('\n') : overlayText).trim();
  const pagesByWords = paginateByWords(bodyForPages, WORDS_PER_PAGE);
  const pages = twBlock ? [twBlock, ...pagesByWords] : pagesByWords;

  // Determine audio duration and final duration
  const audioDur = probeDurationSeconds(audioPath);
  let dur = Math.max(0.5, Number(durationSeconds));
  // prefer audio duration (so voice matches)
  if (audioDur && audioDur > 0.4) dur = Math.max(dur, audioDur + 0.25);

  // per-page timing based on audio dur (continuous, equal division)
  const totalPages = Math.max(1, pages.length);
  let perPage = dur / totalPages;
  if (perPage < MIN_PER_PAGE_SEC) {
    const maxPagesFit = Math.floor(dur / MIN_PER_PAGE_SEC) || 1;
    if (maxPagesFit < totalPages) pages.length = maxPagesFit;
    perPage = Math.max(MIN_PER_PAGE_SEC, dur / pages.length);
  }

  // Build ASS
  const FONTNAME = path.basename(fontPath);
  const ass = [];
  ass.push('[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '');
  ass.push('[V4+ Styles]');
  ass.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  );
  // alignment=8 top-center, marginV=200 (slightly lower than top)
  ass.push(
    `Style: Default,${FONTNAME},${TEXT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,2,8,10,10,200,1`
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

  // get bg duration and decide startOffset and loop usage
  let bgDuration = null;
  try {
    bgDuration = probeDurationSeconds(bgPath);
  } catch (e) {
    console.warn('bg probe failed', e?.message || e);
    bgDuration = null;
  }
  let startOffset = 0;
  if (bgDuration && bgDuration > dur) {
    const maxStart = Math.max(0, bgDuration - dur);
    startOffset = Math.floor(Math.random() * maxStart * 100) / 100;
  } else startOffset = 0;
  const useLoop = !(bgDuration && bgDuration > dur);

  const ffAss = escapeForSubFilter(assPath);
  const fontsDir = path.dirname(fontPath);
  const ffFonts = escapeForSubFilter(fontsDir);
  // crop-to-fill so video fills 1080x1920
  const scaleCrop = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
  const subtitlesFilter = `subtitles='${ffAss}':fontsdir='${ffFonts}'`;
  const vf = `${scaleCrop},${subtitlesFilter}`;

  // Build ffmpeg args: seek before -i bg if startOffset>0, optionally -stream_loop
  const args = ['-y'];
  if (startOffset && startOffset > 0) args.push('-ss', String(startOffset));
  if (useLoop) args.push('-stream_loop', '-1');
  args.push('-i', bgPath);
  args.push('-i', audioPath); // audio will be mapped as track 1
  args.push('-vf', vf);
  args.push('-t', String(Math.max(0.5, dur)));
  // mapping: use video from input 0, audio from input 1
  args.push('-map', '0:v', '-map', '1:a');
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-r',
    String(VIDEO_FPS),
    '-pix_fmt',
    'yuv420p'
  );
  args.push('-c:a', 'aac', '-b:a', '128k');
  args.push(outPath);

  console.log(
    'Chosen startOffset (s):',
    startOffset,
    'bgDuration(s):',
    bgDuration,
    'audioDur(s):',
    audioDur,
    'finalDur(s):',
    dur
  );
  console.log('FFmpeg -vf:', vf);
  console.log('Running ffmpeg:', ffmpeg, args.join(' '));

  const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    fs.removeSync(assPath);
  } catch (e) {}
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const stderr = proc.stderr ? String(proc.stderr) : '';
    const stdout = proc.stdout ? String(proc.stdout) : '';
    throw new Error(`ffmpeg failed: stdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return outPath;
}

// ----------------- Main flow -----------------
async function main() {
  console.log('Starting daily reel bot (ElevenLabs TTS enabled)...');

  let post;
  try {
    post = await fetchCandidatePost();
  } catch (e) {
    console.error('Failed to fetch reddit post:', e?.message || e);
    process.exit(1);
  }

  const titleRaw = post.title || '';
  const bodyRaw = post.selftext || '';
  const subreddit =
    post.subreddit ||
    post.subreddit_name_prefixed ||
    post.subreddit_name ||
    (post.subreddit ? post.subreddit.display_name : 'unknown');
  const author = post.author || post.author_fullname || 'deleted';
  console.log('Selected post:', titleRaw, 'from', subreddit, `(words: ${post._wordCount || 0})`);

  // Improve text with OpenAI (optional). If no OPENAI_API_KEY, fallback to cleaned original
  let improvedBody;
  try {
    improvedBody = await improvePostText(titleRaw, bodyRaw, {
      tone: 'empathetic, concise, engaging',
    });
    console.log('AI improved text length:', improvedBody.length);
  } catch (e) {
    console.warn('AI improvement failed or skipped - using cleaned original:', e?.message || e);
    improvedBody = cleanPost(bodyRaw);
  }

  // Build overlay (wrapped)
  const overlay = buildOverlayLines(titleRaw, improvedBody, subreddit.replace(/^r\//, ''), author);
  console.log('--- overlay (truncated) ---\n', overlay.slice(0, 400), '\n---');

  // generate TTS
  if (!ELEVENLABS_API_KEY) {
    console.error('ELEVENLABS_API_KEY missing in env — cannot generate voice.');
    process.exit(1);
  }
  if (!ELEVENLABS_VOICE_ID) {
    console.error('ELEVENLABS_VOICE_ID missing in env — set the voice id.');
    process.exit(1);
  }

  const tmpDir = path.join(process.cwd(), 'tmp_texts');
  await fs.ensureDir(tmpDir);
  const audioOut = path.join(tmpDir, `tts_${Date.now()}.mp3`);
  try {
    // Compose a TTS payload: title + a short pause + body (or choose only body if you prefer)
    const ttsInput = (titleRaw ? titleRaw + '\n\n' : '') + improvedBody;
    console.log('Generating TTS (may take a few seconds)...');
    // attempt single-call; buildTTSForText will chunk if needed
    await buildTTSForText(ttsInput, audioOut);
    console.log('Saved TTS audio to', audioOut);
  } catch (e) {
    console.error('TTS generation failed:', e?.message || e);
    process.exit(1);
  }

  // pick background
  const bg = pickBackgroundForToday();
  console.log('Using background:', bg);

  // final output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(OUTPUT_DIR, `reel_${timestamp}.mp4`);

  // estimate base duration but audio will set final duration inside renderWithAudio
  function estimateReadSeconds(text, wpm = 170) {
    const words = (text.trim().match(/\S+/g) || []).length;
    return (words / wpm) * 60;
  }
  const estimatedSeconds = Math.max(8, estimateReadSeconds(improvedBody, 170) + 1.0);
  console.log('Estimated (pre-audio) duration:', estimatedSeconds.toFixed(2));

  try {
    await renderWithAudio(bg, overlay, outFile, FONT_PATH, audioOut, {
      durationSeconds: estimatedSeconds,
      streamLoop: true,
    });
    console.log('Rendered:', outFile);
  } catch (e) {
    console.error('Render failed:', e?.message || e);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

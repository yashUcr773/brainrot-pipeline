// Enhanced Brainrot Video Pipeline - Main Entry Point
// Features: AI post selection, caching, metrics, video effects, audio enhancements
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { CacheManager } from './cache.js';
import { MetricsTracker } from './metrics.js';
import {
  fetchCandidatePost,
  improvePostText,
  buildOverlayLines,
  buildTTSForText,
  renderWithAudio,
  pickBackgroundForToday,
} from './pipeline.js';

async function main() {
  const config = loadConfig();
  const cacheManager = new CacheManager(config);
  const metricsTracker = new MetricsTracker();

  try {
    // Initialize
    await cacheManager.initialize();
    await cacheManager.loadData();
    await metricsTracker.load();
    metricsTracker.startRun();

    logger.info('🎬 Starting brainrot video pipeline...');

    // Fetch and select best post
    const post = await fetchCandidatePost(config, cacheManager);
    logger.info(`📝 Selected post: "${post.title.slice(0, 60)}..." from r/${post.subreddit}`);

    // Improve text with AI
    const improvedPost = await improvePostText(
      post.title,
      post.selftext || '',
      config,
      cacheManager
    );

    // Build overlay text
    const overlay = await buildOverlayLines(
      post.title,
      improvedPost,
      post.subreddit.replace(/^r\//, ''),
      post.author,
      cacheManager
    );

    // Generate TTS audio
    logger.info('🎙️  Generating TTS audio...');
    const audioPath = await buildTTSForText(
      (post.title ? post.title + '\n\n' : '') + improvedPost,
      config,
      cacheManager
    );

    // Pick background video
    const bgPath = await pickBackgroundForToday(config, cacheManager);
    console.log('🚀 ~ main ~ bgPath:', bgPath);

    // Render final video
    logger.info('🎥 Rendering video with effects...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = `${config.video.outputDir}/reel_${timestamp}.mp4`;

    await renderWithAudio(bgPath, overlay, outFile, audioPath, config);

    // Mark as processed and record success
    if (config.cache.enabled) {
      cacheManager.markProcessed(post.id);
      await cacheManager.save();
    }

    await metricsTracker.recordSuccess(post.id, post.subreddit);
    await metricsTracker.printSummary();

    logger.info(`✅ Video generated successfully: ${outFile}`);
  } catch (error: any) {
    logger.error('Pipeline failed', { error: error.message, stack: error.stack });
    await metricsTracker.recordFailure(error);
    process.exit(1);
  }
}

main().catch(err => {
  console.log('🚀 ~ err:', err);
  logger.error('Fatal error', { error: err });
  process.exit(1);
});

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import ffmpegPath from 'ffmpeg-static';
import { logger } from './logger.js';
import type { Config } from './config.js';

// Workaround for ffmpeg-static TypeScript types
const ffmpeg = ffmpegPath as unknown as string;

export interface VideoEffect {
  type: 'zoom' | 'pan' | 'fade';
  intensity: number;
}

export class VideoEffectsManager {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Create a complex video filter with zoom, smooth transitions
   */
  createAdvancedFilter(duration: number, assPath: string, fontsDir: string): string {
    const { width, height } = this.config.video.resolution;

    // Escape paths for FFmpeg
    const ffAss = this.escapeForSubFilter(assPath);
    const ffFonts = this.escapeForSubFilter(fontsDir);

    // Base: scale and crop to fill
    const scaleCrop = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

    // Add subtle zoom effect (1.0x to 1.05x over the duration)
    const zoomRate = 0.05 / duration; // zoom 5% over full duration
    const zoomFilter =
      `zoompan=` +
      `z='1+(${zoomRate}*t)*(1+${zoomRate}*t<1.05)':` +
      `x='iw/2-(iw/zoom/2)':` +
      `y='ih/2-(ih/zoom/2)':` +
      `d=1:` +
      `fps=${this.config.video.fps}:` +
      `s=${width}x${height}`;

    // Add subtle saturation boost for engagement
    const colorFilter = 'eq=saturation=1.1:brightness=0.02';

    // Subtitles with fade in/out
    const subtitlesFilter = `subtitles='${ffAss}':fontsdir='${ffFonts}'`;

    // Combine all filters
    return [scaleCrop, zoomFilter, colorFilter, subtitlesFilter, 'setpts=PTS-STARTPTS'].join(',');
  }

  /**
   * Create video filter without zoom (for faster rendering)
   */
  createSimpleFilter(assPath: string, fontsDir: string): string {
    const { width, height } = this.config.video.resolution;

    const ffAss = this.escapeForSubFilter(assPath);
    const ffFonts = this.escapeForSubFilter(fontsDir);

    const scaleCrop = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const subtitlesFilter = `subtitles='${ffAss}':fontsdir='${ffFonts}'`;

    return `${scaleCrop},${subtitlesFilter}`;
  }

  private escapeForSubFilter(p: string): string {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  }

  /**
   * Add background music to video
   */
  async addBackgroundMusic(
    videoPath: string,
    musicPath: string,
    outputPath: string,
    musicVolume: number = 0.15
  ): Promise<string> {
    if (!fs.pathExistsSync(musicPath)) {
      logger.warn('Background music file not found, skipping', { musicPath });
      return videoPath;
    }

    logger.info('Adding background music', { volume: musicVolume });

    const args = [
      '-y',
      '-i',
      videoPath,
      '-stream_loop',
      '-1',
      '-i',
      musicPath,
      '-filter_complex',
      `[1:a]volume=${musicVolume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      outputPath,
    ];

    const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    if (proc.error || proc.status !== 0) {
      const stderr = proc.stderr ? String(proc.stderr) : '';
      logger.error('Failed to add background music', { stderr });
      return videoPath;
    }

    logger.info('Background music added successfully');
    return outputPath;
  }

  /**
   * Normalize audio levels for consistent volume
   */
  async normalizeAudio(audioPath: string, outputPath: string): Promise<string> {
    logger.debug('Normalizing audio levels');

    // Use loudnorm filter for consistent audio levels
    const args = [
      '-y',
      '-i',
      audioPath,
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar',
      '44100',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outputPath,
    ];

    const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    if (proc.error || proc.status !== 0) {
      logger.warn('Audio normalization failed, using original', {
        error: proc.stderr,
      });
      return audioPath;
    }

    logger.debug('Audio normalized successfully');
    return outputPath;
  }

  /**
   * Add fade in/out effects to audio
   */
  async addAudioFades(
    audioPath: string,
    outputPath: string,
    fadeInDuration: number = 0.3,
    fadeOutDuration: number = 0.5
  ): Promise<string> {
    logger.debug('Adding audio fade effects');

    const args = [
      '-y',
      '-i',
      audioPath,
      '-af',
      `afade=t=in:st=0:d=${fadeInDuration},afade=t=out:st=${fadeOutDuration}:d=${fadeOutDuration}`,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outputPath,
    ];

    const proc = spawnSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    if (proc.error || proc.status !== 0) {
      logger.warn('Audio fade failed, using original');
      return audioPath;
    }

    logger.debug('Audio fades added successfully');
    return outputPath;
  }
}

import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';

export interface Metrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageProcessingTime: number;
  totalVideosGenerated: number;
  subredditStats: Record<string, number>;
  errorTypes: Record<string, number>;
  lastRun?: {
    timestamp: string;
    success: boolean;
    duration: number;
    postId?: string;
    error?: string;
  };
}

export class MetricsTracker {
  private metricsFile: string;
  private metrics: Metrics;
  private runStartTime?: number;

  constructor(metricsFile: string = 'cache/metrics.json') {
    this.metricsFile = path.resolve(metricsFile);
    this.metrics = this.getDefaultMetrics();
  }

  private getDefaultMetrics(): Metrics {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      averageProcessingTime: 0,
      totalVideosGenerated: 0,
      subredditStats: {},
      errorTypes: {},
    };
  }

  async load(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.metricsFile));

      if (await fs.pathExists(this.metricsFile)) {
        this.metrics = await fs.readJson(this.metricsFile);
        logger.debug('Loaded metrics', {
          totalRuns: this.metrics.totalRuns,
          successRate: this.getSuccessRate(),
        });
      }
    } catch (error) {
      logger.error('Failed to load metrics', { error });
    }
  }

  startRun(): void {
    this.runStartTime = Date.now();
    this.metrics.totalRuns++;
  }

  async recordSuccess(postId: string, subreddit: string): Promise<void> {
    const duration = this.runStartTime ? Date.now() - this.runStartTime : 0;

    this.metrics.successfulRuns++;
    this.metrics.totalVideosGenerated++;
    this.metrics.subredditStats[subreddit] = (this.metrics.subredditStats[subreddit] || 0) + 1;

    // Update average processing time
    const totalTime =
      this.metrics.averageProcessingTime * (this.metrics.successfulRuns - 1) + duration;
    this.metrics.averageProcessingTime = totalTime / this.metrics.successfulRuns;

    this.metrics.lastRun = {
      timestamp: new Date().toISOString(),
      success: true,
      duration,
      postId,
    };

    await this.save();
    logger.info('Run successful', {
      duration: `${(duration / 1000).toFixed(2)}s`,
      successRate: this.getSuccessRate(),
    });
  }

  async recordFailure(error: Error): Promise<void> {
    const duration = this.runStartTime ? Date.now() - this.runStartTime : 0;

    this.metrics.failedRuns++;

    const errorType = error.name || 'UnknownError';
    this.metrics.errorTypes[errorType] = (this.metrics.errorTypes[errorType] || 0) + 1;

    this.metrics.lastRun = {
      timestamp: new Date().toISOString(),
      success: false,
      duration,
      error: error.message,
    };

    await this.save();
    logger.error('Run failed', {
      error: error.message,
      successRate: this.getSuccessRate(),
    });
  }

  getSuccessRate(): string {
    if (this.metrics.totalRuns === 0) return '0%';
    return `${((this.metrics.successfulRuns / this.metrics.totalRuns) * 100).toFixed(1)}%`;
  }

  private async save(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.metricsFile));
      await fs.writeJson(this.metricsFile, this.metrics, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save metrics', { error });
    }
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  async printSummary(): Promise<void> {
    logger.info('=== Pipeline Metrics Summary ===');
    logger.info(`Total runs: ${this.metrics.totalRuns}`);
    logger.info(`Successful: ${this.metrics.successfulRuns}`);
    logger.info(`Failed: ${this.metrics.failedRuns}`);
    logger.info(`Success rate: ${this.getSuccessRate()}`);
    logger.info(`Avg processing time: ${(this.metrics.averageProcessingTime / 1000).toFixed(2)}s`);
    logger.info(`Total videos: ${this.metrics.totalVideosGenerated}`);

    if (Object.keys(this.metrics.subredditStats).length > 0) {
      logger.info('Top subreddits:');
      const sorted = Object.entries(this.metrics.subredditStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      sorted.forEach(([sub, count]) => logger.info(`  r/${sub}: ${count}`));
    }
  }
}

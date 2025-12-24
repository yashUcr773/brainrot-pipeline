import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import type { Config } from './config.js';

type TempCacheKeys = 'post' | 'improved_post' | 'overlay' | 'cachedTTSText' | 'bg';

export interface PostHistory {
  processedPosts: Set<string>;
  lastUpdated: Date;
}

export class CacheManager {
  private historyFile: string;
  private maxHistorySize: number;
  private processedPosts: Set<string>;
  private data: Record<string, any>;

  constructor(config: Config) {
    this.historyFile = config.cache.historyFile;
    this.maxHistorySize = config.cache.maxHistorySize;
    this.processedPosts = new Set();
    this.data = {};
  }

  async initialize(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.historyFile));

      if (await fs.pathExists(this.historyFile)) {
        const data = await fs.readJson(this.historyFile);
        this.processedPosts = new Set(data.processedPosts || []);
        logger.info(`Loaded ${this.processedPosts.size} processed posts from cache`);
      }
    } catch (error) {
      logger.error('Failed to initialize cache', { error });
    }
  }

  hasProcessed(postId: string): boolean {
    return this.processedPosts.has(postId);
  }

  markProcessed(postId: string): void {
    this.processedPosts.add(postId);

    // Trim if too large
    if (this.processedPosts.size > this.maxHistorySize) {
      const array = Array.from(this.processedPosts);
      const toKeep = array.slice(-this.maxHistorySize);
      this.processedPosts = new Set(toKeep);
      logger.info(`Trimmed cache to ${this.maxHistorySize} entries`);
    }
  }

  /**
   * Stores a value in memory by key
   */
  set(key: TempCacheKeys, value: any): void {
    this.data[key] = value;
  }

  /**
   * Retrieves a value from memory by key
   */
  get(key: TempCacheKeys): any {
    return this.data[key];
  }

  /**
   * Loads key/value cache data from cache_temp/data into memory
   */
  async loadData(): Promise<void> {
    try {
      const dataPath = path.resolve('cache_temp/data.json');

      if (await fs.pathExists(dataPath)) {
        this.data = await fs.readJson(dataPath);
        logger.info(`Loaded ${Object.keys(this.data).length} entries from temp cache`);
      }
    } catch (error) {
      logger.error('Failed to load temp cache data', { error });
    }
  }

  /**
   * Saves key/value cache data to cache_temp/data
   */
  async saveData(): Promise<void> {
    try {
      const dataPath = path.resolve('cache_temp/data.json');
      console.log('🚀 ~ CacheManager ~ saveData ~ dataPath:', dataPath);

      await fs.ensureDir(path.dirname(dataPath));
      await fs.writeJson(dataPath, this.data, { spaces: 2 });

      logger.debug(`Saved ${Object.keys(this.data).length} entries to temp cache`);
    } catch (error) {
      logger.error('Failed to save temp cache data', { error });
    }
  }

  async save(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.historyFile));
      await fs.writeJson(
        this.historyFile,
        {
          processedPosts: Array.from(this.processedPosts),
          lastUpdated: new Date().toISOString(),
        },
        { spaces: 2 }
      );
      logger.debug(`Saved cache with ${this.processedPosts.size} entries`);
    } catch (error) {
      logger.error('Failed to save cache', { error });
    }
  }
}

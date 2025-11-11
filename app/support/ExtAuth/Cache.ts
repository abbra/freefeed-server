import crypto from 'crypto';

import { createCache, Cache as TCache } from 'cache-manager';
import { ioRedisStore } from '@tirke/node-cache-manager-ioredis';

import { connect as redisConnect } from '../../setup/database';

const KEY_LENGTH = 16; // bytes

/**
 * Wrapper for the redis-based cache with auto-generated and auto-prefixed keys
 */
export class Cache {
  private readonly cache: TCache;

  constructor(
    private readonly keyPrefix: string,
    private readonly ttl: number,
  ) {
    // Type assertion needed due to ioredis version mismatch between
    // @tirke/node-cache-manager-ioredis (expects 5.2.x) and current version (5.7.0)
    // TODO: replace @tirke/node-cache-manager-ioredis with something supported by cache-manager
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.cache = createCache(ioRedisStore({ redisInstance: redisConnect() as any }), { ttl });
  }

  async put<T>(data: T) {
    const key = crypto.randomBytes(KEY_LENGTH).toString('base64');
    await this.cache.set(this.keyPrefix + key, data, this.ttl);
    return key;
  }

  async update<T>(key: string, data: T) {
    await this.cache.set(this.keyPrefix + key, data, this.ttl);
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.cache.get(this.keyPrefix + key);
  }

  async delete(key: string) {
    await this.cache.del(this.keyPrefix + key);
  }
}

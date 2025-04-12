import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { GalleryItem } from './entities/gallery.entity';
import { SearchHistory } from './entities/search-history.entity';
import { SearchDto, SortBy, SortOrder } from './dto/search.dto';
import { User } from '../auth/entities/user.entity';

interface SearchResult {
  items: GalleryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function isSearchResult(data: unknown): data is SearchResult {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as any).items) &&
    typeof (data as any).total === 'number' &&
    typeof (data as any).page === 'number' &&
    typeof (data as any).limit === 'number' &&
    typeof (data as any).totalPages === 'number'
  );
}

function isSearchHistoryArray(data: unknown): data is SearchHistory[] {
  return (
    Array.isArray(data) &&
    data.every(
      item =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.query === 'string' &&
        typeof item.createdAt === 'string',
    )
  );
}

@Injectable()
export class GallerySearchService {
  private readonly logger = new Logger(GallerySearchService.name);

  constructor(
    @InjectRepository(GalleryItem)
    private galleryRepository: Repository<GalleryItem>,
    @InjectRepository(SearchHistory)
    private searchHistoryRepository: Repository<SearchHistory>,
    @Inject(CACHE_MANAGER)
    public cacheManager: Cache,
  ) {}

  async search(params: SearchDto, user?: User): Promise<SearchResult> {
    const startTime = Date.now();
    const cacheKey = `search:${JSON.stringify(params)}`;
    this.logger.log(`Starting search: params=${JSON.stringify(params)}, userId=${user?.id ?? 'anonymous'}`);

    // Log user details for debugging
    this.logger.debug(`User details: id=${user?.id}, email=${user?.email}, role=${user?.role}`);

    // Save search history
    if (user?.id && params.keyword) {
      this.logger.debug(`Saving search history for userId=${user.id}, keyword=${params.keyword}`);
      try {
        const history = this.searchHistoryRepository.create({
          query: params.keyword,
          user,
        });
        await this.searchHistoryRepository.save(history);
        this.logger.debug(`Saved search history: query=${params.keyword}`);

        // Clear the search history cache for this user after adding new entry
        const historyCacheKey = `search-history:${user.id}:*`;
        await this.clearCache(historyCacheKey);
      } catch (err) {
        this.logger.error(`Failed to save search history: ${(err as Error).message}`, (err as Error).stack);
      }
    }

    try {
      // Try to get data from cache
      const cached = await this.cacheManager.get<string>(cacheKey);
      if (cached) {
        const parsedCache = JSON.parse(cached);
        if (isSearchResult(parsedCache)) {
          this.logger.log(`Cache hit for ${cacheKey}, duration=${Date.now() - startTime}ms`);
          return parsedCache;
        }
      }
    } catch (err) {
      // Log cache error but continue with database query
      this.logger.error(`Cache read error: ${(err as Error).message}`, (err as Error).stack);
    }

    const {
      keyword,
      tag,
      uploaderId,
      startDate,
      endDate,
      sortBy = SortBy.UploadedAt,
      sortOrder = SortOrder.DESC,
      page = 1,
      limit = 10,
    } = params;

    const query = this.galleryRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.uploadedBy', 'user')
      .where('item.isApproved = :isApproved', { isApproved: true });

    if (keyword) {
      query.andWhere('item.searchVector @@ to_tsquery(:keyword)', { keyword: `${keyword}:*` });
    }

    if (tag) {
      query.andWhere(':tag = ANY(item.tags)', { tag });
    }

    if (uploaderId) {
      query.andWhere('item.uploadedBy.id = :uploaderId', { uploaderId });
    }

    if (startDate) {
      query.andWhere('item.uploadedAt >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('item.uploadedAt <= :endDate', { endDate });
    }

    query.orderBy(`item.${sortBy}`, sortOrder).skip((page - 1) * limit).take(limit);

    try {
      const [items, total] = await query.getManyAndCount();
      const result: SearchResult = {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };

      // Store in cache
      try {
        await this.cacheManager.set(cacheKey, JSON.stringify(result), 300 * 1000); // ttl in ms
      } catch (err) {
        this.logger.error(`Cache write error: ${(err as Error).message}`, (err as Error).stack);
      }

      this.logger.log(
        `Search completed: found ${total} items, page=${page}, limit=${limit}, duration=${Date.now() - startTime}ms`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Search failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  async getSearchHistory(user: User, limit: number = 10, skipCache: boolean = false): Promise<SearchHistory[]> {
    const startTime = Date.now();
    const cacheKey = `search-history:${user.id}:${limit}`;
    this.logger.log(`Fetching search history for userId=${user.id}, limit=${limit}, skipCache=${skipCache}`);

    if (!skipCache) {
      try {
        // Try to get data from cache
        const cached = await this.cacheManager.get<string>(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          if (isSearchHistoryArray(parsedCache)) {
            this.logger.log(`Cache hit for ${cacheKey}, duration=${Date.now() - startTime}ms`);
            return parsedCache;
          }
        }
      } catch (err) {
        // Log cache error but continue with database query
        this.logger.error(`Cache read error: ${(err as Error).message}`, (err as Error).stack);
      }
    } else {
      this.logger.log(`Skipping cache for search history as requested`);
    }

    try {
      const history = await this.searchHistoryRepository.find({
        where: { user: { id: user.id } },
        order: { createdAt: 'DESC' },
        take: limit,
      });

      if (!skipCache) {
        // Store in cache
        try {
          await this.cacheManager.set(cacheKey, JSON.stringify(history), 300 * 1000); // ttl in ms
        } catch (err) {
          this.logger.error(`Cache write error: ${(err as Error).message}`, (err as Error).stack);
        }
      }

      this.logger.log(`Fetched ${history.length} history items, duration=${Date.now() - startTime}ms`);
      return history;
    } catch (error) {
      this.logger.error(`Failed to fetch search history: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  // Improved cache clearing method with Redis pattern support
  async clearCache(pattern: string): Promise<void> {
    try {
      this.logger.log(`Attempting to clear cache with pattern: ${pattern}`);

      // Try to access the Redis client from the cache manager
      const store: any = (this.cacheManager as any).store;

      if (store && typeof store.getClient === 'function') {
        const redisClient = store.getClient();

        if (redisClient) {
          if (pattern.includes('*')) {
            // For pattern-based clearing
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
              // Use multi-key deletion if supported
              if (typeof redisClient.del === 'function') {
                await redisClient.del(keys);
                this.logger.log(`Cleared ${keys.length} cache keys matching pattern: ${pattern}`);
              } else {
                // Fallback to individual deletions
                for (const key of keys) {
                  await this.cacheManager.del(key);
                }
                this.logger.log(`Cleared ${keys.length} individual cache keys matching pattern: ${pattern}`);
              }
            } else {
              this.logger.log(`No cache keys found matching pattern: ${pattern}`);
            }
          } else {
            // For specific key deletion
            await this.cacheManager.del(pattern);
            this.logger.log(`Cleared specific cache key: ${pattern}`);
          }
        } else {
          this.logger.warn(`Redis client not accessible. Falling back to direct cache deletion.`);
          await this.cacheManager.del(pattern);
          this.logger.log(`Attempted to clear specific cache key: ${pattern}`);
        }
      } else {
        // Fallback for non-Redis cache managers
        this.logger.warn(`Redis client methods not available. Cannot clear by pattern.`);
        if (!pattern.includes('*')) {
          await this.cacheManager.del(pattern);
          this.logger.log(`Cleared specific cache key: ${pattern}`);
        } else {
          this.logger.warn(`Pattern-based cache clearing not supported by the current cache manager: ${pattern}`);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to clear cache: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}

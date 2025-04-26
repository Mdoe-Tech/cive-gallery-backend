// src/gallery/gallery-search.service.ts

import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { GalleryItem } from './entities/gallery.entity';
import { SearchHistory } from './entities/search-history.entity';
import { SearchDto, SortBy, SortOrder } from './dto/search.dto';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../common/interfaces/entities.interface';

// --- Interfaces ---

interface SearchResult {
  items: GalleryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// --- Type Guards ---

function isSearchResult(data: unknown): data is SearchResult {
  // (Implementation remains the same)
  return (
    typeof data === 'object' && data !== null &&
    Array.isArray((data as any).items) &&
    typeof (data as any).total === 'number' &&
    typeof (data as any).page === 'number' &&
    typeof (data as any).limit === 'number' &&
    typeof (data as any).totalPages === 'number'
  );
}

function isSearchHistoryArray(data: unknown): data is SearchHistory[] {
  // (Implementation remains the same)
  return (
    Array.isArray(data) &&
    data.every(
      item =>
        typeof item === 'object' && item !== null &&
        typeof item.id === 'string' &&
        typeof item.query === 'string' &&
        (typeof item.createdAt === 'string' || item.createdAt instanceof Date),
    )
  );
}

// --- Service ---

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
    const cacheKey = `search:${JSON.stringify(params)}:userRole:${user?.role ?? 'public'}`;
    this.logger.log(`Starting search: params=${JSON.stringify(params)}, userId=${user?.id ?? 'anonymous'}, role=${user?.role}`);

    // --- Search History Saving ---
    if (user?.id && params.keyword && params.keyword.trim()) {
      this.logger.debug(`Saving search history for userId=${user.id}, keyword=${params.keyword}`);
      try {
        const history = this.searchHistoryRepository.create({
          query: params.keyword.trim(),
          user,
        });
        await this.searchHistoryRepository.save(history);
        this.logger.debug(`Saved search history entry.`);
        const historyCacheKeyPattern = `search-history:${user.id}:*`;
        // Intentionally not awaiting clearCache here to avoid delaying search response
        this.clearCache(historyCacheKeyPattern).catch(clearErr => {
          this.logger.error(`Failed to clear history cache after saving new entry: ${(clearErr as Error).message}`, (clearErr as Error).stack);
        });
      } catch (err) { // Using the caught error variable 'err'
        this.logger.error(`Failed to save search history: ${(err as Error).message}`, (err as Error).stack);
      }
    }

    // --- Cache Read Attempt ---
    try {
      const cachedData = await this.cacheManager.get<string>(cacheKey);
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        if (isSearchResult(parsedCache)) {
          this.logger.log(`Cache hit for key ${cacheKey}, duration=${Date.now() - startTime}ms`);
          return parsedCache;
        } else {
          this.logger.warn(`Invalid data found in cache for key ${cacheKey}. Fetching from DB.`);
          await this.cacheManager.del(cacheKey);
        }
      } else {
        this.logger.log(`Cache miss for key ${cacheKey}.`);
      }
    } catch (err) { // Using the caught error variable 'err'
      this.logger.error(`Cache read error for key ${cacheKey}: ${(err as Error).message}`, (err as Error).stack);
    }

    // --- Destructure Parameters ---
    const {
      keyword, tag, uploaderId, startDate, endDate, isApproved,
      sortBy = SortBy.UploadedAt, sortOrder = SortOrder.DESC, page = 1, limit = 10,
    } = params;

    // --- Build Database Query ---
    const query = this.galleryRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.uploadedBy', 'user');

    let hasWhereClause = false;

    // --- Conditional isApproved Filtering Logic ---
    if (typeof isApproved === 'boolean') {
      query.where('item.isApproved = :isApprovedValue', { isApprovedValue: isApproved });
      hasWhereClause = true;
      this.logger.debug(`Applying explicit filter: isApproved = ${isApproved}`);
    } else {
      const isAdminOrStaff = user?.role === UserRole.Admin || user?.role === UserRole.Staff;
      if (!isAdminOrStaff) {
        query.where('item.isApproved = :isApprovedValue', { isApprovedValue: true });
        hasWhereClause = true;
        this.logger.debug(`User role (${user?.role}) requires seeing only approved items.`);
      } else {
        this.logger.debug(`Admin/Staff user (${user?.role}) viewing all items (no isApproved filter applied).`);
      }
    }

    // --- Apply Other Filters using andWhere ---
    const addCondition = (condition: string, parameters?: any) => {
      if (hasWhereClause) {
        query.andWhere(condition, parameters);
      } else {
        query.where(condition, parameters);
        hasWhereClause = true;
      }
    };

    if (keyword && keyword.trim()) {
      addCondition('item.searchVector @@ plainto_tsquery(\'english\', :keyword)', { keyword: keyword.trim() });
      this.logger.debug(`Applying keyword filter: ${keyword.trim()}`);
    }
    if (tag && tag.trim()) {
      addCondition(':tag = ANY(item.tags)', { tag: tag.trim() });
      this.logger.debug(`Applying tag filter: ${tag.trim()}`);
    }
    if (uploaderId) {
      addCondition('item.uploadedBy.id = :uploaderId', { uploaderId });
      this.logger.debug(`Applying uploader filter: ${uploaderId}`);
    }
    if (startDate) {
      try {
        const validStartDate = new Date(startDate);
        addCondition('item.uploadedAt >= :startDate', { startDate: validStartDate });
        this.logger.debug(`Applying start date filter: ${startDate}`);
      } catch (e) { // Using the caught error variable 'e'
        this.logger.warn(`Invalid start date format received: ${startDate}. Error: ${(e as Error).message}`);
      }
    }
    if (endDate) {
      try {
        const validEndDate = new Date(endDate);
        // Optional: Set time to end of day: validEndDate.setHours(23, 59, 59, 999);
        addCondition('item.uploadedAt <= :endDate', { endDate: validEndDate });
        this.logger.debug(`Applying end date filter: ${endDate}`);
      } catch (e) { // Using the caught error variable 'e'
        this.logger.warn(`Invalid end date format received: ${endDate}. Error: ${(e as Error).message}`);
      }
    }

    // --- Execute Query with Sorting & Pagination ---
    query
      .orderBy(`item.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    this.logger.debug(`Executing query: ${query.getSql()}`);

    try {
      const [items, total] = await query.getManyAndCount();
      const totalPages = Math.ceil(total / limit);
      const result: SearchResult = { items, total, page, limit, totalPages };

      // --- Cache Write Attempt ---
      try {
        const ttlConfig = (this.cacheManager as any).store?.options?.ttl; // Safely access ttl if store exists
        const ttl = (typeof ttlConfig === 'number' && ttlConfig > 0) ? ttlConfig : 300 * 1000; // Default 5 mins
        await this.cacheManager.set(cacheKey, JSON.stringify(result), ttl);
        this.logger.log(`Stored search results in cache for key ${cacheKey}.`);
      } catch (err) { // Using the caught error variable 'err'
        this.logger.error(`Cache write error for key ${cacheKey}: ${(err as Error).message}`, (err as Error).stack);
      }

      this.logger.log(`Search completed: found ${total} items, page=${page}/${totalPages}, limit=${limit}, duration=${Date.now() - startTime}ms`);
      return result;

    } catch (error) { // Using the caught error variable 'error'
      this.logger.error(`Database search failed: ${(error as Error).message}`, (error as Error).stack);
      throw error; // Re-throw the error
    }
  }

  async getSearchHistory(user: User, limit: number = 10, skipCache: boolean = false): Promise<SearchHistory[]> {
    const startTime = Date.now();
    const cacheKey = `search-history:${user.id}:${limit}`;
    this.logger.log(`Fetching search history for userId=${user.id}, limit=${limit}, skipCache=${skipCache}`);

    // Cache read attempt
    if (!skipCache) {
      try {
        const cached = await this.cacheManager.get<string>(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          if (isSearchHistoryArray(parsedCache)) {
            this.logger.log(`Cache hit for search history key ${cacheKey}, duration=${Date.now() - startTime}ms`);
            return parsedCache;
          } else {
            this.logger.warn(`Invalid data found in cache for key ${cacheKey}. Fetching from DB.`);
            await this.cacheManager.del(cacheKey);
          }
        }
      } catch (err) { // Using the caught error variable 'err'
        this.logger.error(`Cache read error for history key ${cacheKey}: ${(err as Error).message}`, (err as Error).stack);
      }
    } else {
      this.logger.log(`Skipping cache for search history request.`);
    }

    // DB query
    try {
      const history = await this.searchHistoryRepository.find({
        where: { user: { id: user.id } },
        order: { createdAt: 'DESC' },
        take: limit,
        select: ['id', 'query', 'createdAt'],
      });

      // Cache write attempt
      if (!skipCache) {
        try {
          const ttlConfig = (this.cacheManager as any).store?.options?.ttl; // Safely access ttl
          const ttl = (typeof ttlConfig === 'number' && ttlConfig > 0) ? ttlConfig : 300 * 1000;
          await this.cacheManager.set(cacheKey, JSON.stringify(history), ttl);
          this.logger.log(`Stored search history in cache for key ${cacheKey}.`);
        } catch (err) { // Using the caught error variable 'err'
          this.logger.error(`Cache write error for history key ${cacheKey}: ${(err as Error).message}`, (err as Error).stack);
        }
      }

      this.logger.log(`Fetched ${history.length} history items from DB, duration=${Date.now() - startTime}ms`);
      return history;
    } catch (error) { // Using the caught error variable 'error'
      this.logger.error(`Failed to fetch search history from DB: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  // In clearCache method...
  async clearCache(pattern: string): Promise<void> {
    try {
      this.logger.log(`Attempting to clear cache with pattern: ${pattern}`);

      // Runtime check if 'store' property exists on the cacheManager instance
      const store = (this.cacheManager as any)?.store;

      if (store && typeof (store).getClient === 'function') {
        const redisClient = (store).getClient();
        if (redisClient && typeof redisClient.scan === 'function' && typeof redisClient.del === 'function') {
          // ... SCAN/DEL logic ...
        } else {
          this.logger.warn(`Redis client or required methods (scan, del) not accessible.`);
          // Attempt fallback using generic del if no pattern
          if (!pattern.includes('*') && !pattern.includes('?')) {
            await this.cacheManager.del(pattern);
            this.logger.log(`Attempted to clear specific cache key using basic del: ${pattern}`);
          }
        }

      } else {
        // Fallback for non-Redis or inaccessible store
        this.logger.warn(`Underlying cache store or getClient method not available.`);
        if (!pattern.includes('*') && !pattern.includes('?')) {
          await this.cacheManager.del(pattern);
          this.logger.log(`Attempted to clear specific cache key using basic del: ${pattern}`);
        } else {
          this.logger.warn(`Pattern-based cache clearing requires Redis compatible store with accessible client: ${pattern}`);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to clear cache: ${(err as Error).message}`, (err as Error).stack);
    }
  }

}

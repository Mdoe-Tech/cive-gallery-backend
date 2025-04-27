// src/search/search.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  StreamableFile,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Event, EventStatus } from '../events/entities/event.entity';
import { Update } from '../updates/entities/update.entity';
import { SearchHistory } from './entities/search-history.entity';
import { ShareLink } from './entities/share-link.entity';
import { Annotation } from './entities/annotation.entity';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../common/interfaces/entities.interface';
import { GalleryItem } from '../gallery/entities/gallery.entity';
import { SearchQueryDto, SearchableItemType } from './dto/search-query.dto';
import { SharingPlatform } from './dto/share-item.dto';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { Response } from 'express';
import { UpdatesService } from '../updates/updates.service';
import { GalleryService } from '../gallery/gallery.service';

export interface SearchResultItem {
  id: string;
  type: SearchableItemType;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  createdAt: Date;
  tags?: string[];
}

export interface PaginatedSearchResults {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly SUGGESTIONS_LIMIT = 6;
  private readonly HISTORY_LIMIT = 5;
  private readonly CACHE_TTL_SECONDS = 300;

  constructor(
    @InjectRepository(GalleryItem) private galleryRepository: Repository<GalleryItem>,
    @InjectRepository(Event) private eventRepository: Repository<Event>,
    @InjectRepository(Update) private updateRepository: Repository<Update>,
    @InjectRepository(SearchHistory) private searchHistoryRepository: Repository<SearchHistory>,
    @InjectRepository(ShareLink) private shareLinkRepository: Repository<ShareLink>,
    @InjectRepository(Annotation) private annotationRepository: Repository<Annotation>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
    private updatesService: UpdatesService,
    private galleryService: GalleryService,
  ) {
    this.logger.log('SearchService initialized');
  }

  async search(user: User | null, params: SearchQueryDto): Promise<PaginatedSearchResults> {
    const { query, tags, types = [], startDate, endDate, page = 1, limit = 12, skipCache = false } = params;
    const userIdForLog = user?.id || 'guest';
    this.logger.log(`Searching: query="${query}", types=${types.join(',')}, tags=${tags?.join(',')}, dates=${startDate}-${endDate}, page=${page}, limit=${limit}, user=${userIdForLog}`);

    const searchTypes = types.length === 0 ? [SearchableItemType.Gallery, SearchableItemType.Event, SearchableItemType.Update] : types;
    const cacheKey = `search:${userIdForLog}:${JSON.stringify(params)}`;

    if (!skipCache) {
      // ... (cache check logic remains the same) ...
      const cached = await this.cacheManager.get<string>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${cacheKey}`);
        try {
          return JSON.parse(cached);
        } catch (error) {
          this.logger.warn(`Bad cache data for key ${cacheKey}: ${error}`);
          await this.cacheManager.del(cacheKey); // Invalidate bad cache
        }
      } else {
        this.logger.debug(`Cache miss: ${cacheKey}`);
      }
    }

    // Note: We will fetch items *without* skip/limit first, then apply pagination later.
    // We still need skip calculation for the final slicing.
    const skip = (page - 1) * limit;
    const dateStart = startDate ? new Date(startDate) : undefined;
    const dateEnd = endDate ? new Date(endDate) : undefined;
    const textSearchConfig = 'simple'; // Or 'english'

    const trimmedQuery = query ? query.trim() : null;
    const createPrefixTsQuery = (rawQuery: string | null): string | null => {
      if (!rawQuery) return null;
      const sanitizedQuery = rawQuery.replace(/[&|!()<>-]/g, ' ');
      const terms = sanitizedQuery.split(/\s+/).filter(Boolean);
      if (terms.length === 0) return null;
      return terms.map(term => term + ':*').join(' & ');
    };
    const prefixTsQuery = createPrefixTsQuery(trimmedQuery);
    if (prefixTsQuery) {
      this.logger.debug(`Generated prefix tsquery string: ${prefixTsQuery}`);
    }

    // --- Build Queries WITHOUT skip/take for fetching items ---
    const itemPromises: Promise<any[]>[] = [];
    // --- Build COUNT Queries SEPARATELY ---
    const countPromises: Promise<number>[] = [];

    // Gallery Query
    if (searchTypes.includes(SearchableItemType.Gallery)) {
      const itemQb = this.galleryRepository.createQueryBuilder('item')
        .where('item.isApproved = true');
      const countQb = this.galleryRepository.createQueryBuilder('item')
        .where('item.isApproved = true');

      if (prefixTsQuery) {
        itemQb.andWhere(`item.searchVector @@ to_tsquery(:config, :query)`, { config: textSearchConfig, query: prefixTsQuery });
        countQb.andWhere(`item.searchVector @@ to_tsquery(:config, :query)`, { config: textSearchConfig, query: prefixTsQuery });
      }
      if (tags?.length) {
        itemQb.andWhere('item.tags && :tags', { tags });
        countQb.andWhere('item.tags && :tags', { tags });
      }
      if (dateStart) {
        itemQb.andWhere('item.uploadedAt >= :startDate', { startDate: dateStart });
        countQb.andWhere('item.uploadedAt >= :startDate', { startDate: dateStart });
      }
      if (dateEnd) {
        itemQb.andWhere('item.uploadedAt <= :endDate', { endDate: dateEnd });
        countQb.andWhere('item.uploadedAt <= :endDate', { endDate: dateEnd });
      }
      // Fetch all matching items, sort later
      itemPromises.push(itemQb.getMany());
      countPromises.push(countQb.getCount());
    } else {
      itemPromises.push(Promise.resolve([]));
      countPromises.push(Promise.resolve(0));
    }

    // Event Query
    if (searchTypes.includes(SearchableItemType.Event)) {
      const itemQb = this.eventRepository.createQueryBuilder('item')
        .where('item.status != :cancelled', { cancelled: EventStatus.Cancelled });
      const countQb = this.eventRepository.createQueryBuilder('item')
        .where('item.status != :cancelled', { cancelled: EventStatus.Cancelled });

      if (prefixTsQuery) {
        itemQb.andWhere(`to_tsvector(:config, coalesce(item.title, '') || ' ' || coalesce(item.description, '') || ' ' || coalesce(item.location, '') || ' ' || coalesce(item.organizer, '')) @@ to_tsquery(:config, :query)`, { config: textSearchConfig, query: prefixTsQuery });
        countQb.andWhere(`to_tsvector(:config, coalesce(item.title, '') || ' ' || coalesce(item.description, '') || ' ' || coalesce(item.location, '') || ' ' || coalesce(item.organizer, '')) @@ to_tsquery(:config, :query)`, { config: textSearchConfig, query: prefixTsQuery });
      }
      if (dateStart) {
        itemQb.andWhere('item.startDate >= :startDate', { startDate: dateStart });
        countQb.andWhere('item.startDate >= :startDate', { startDate: dateStart });
      }
      if (dateEnd) {
        itemQb.andWhere('item.startDate <= :endDate', { endDate: dateEnd });
        countQb.andWhere('item.startDate <= :endDate', { endDate: dateEnd });
      }
      // Fetch all matching items, sort later
      itemPromises.push(itemQb.getMany());
      countPromises.push(countQb.getCount());
    } else {
      itemPromises.push(Promise.resolve([]));
      countPromises.push(Promise.resolve(0));
    }

    // Update Query
    if (searchTypes.includes(SearchableItemType.Update)) {
      const itemQb = this.updateRepository.createQueryBuilder('item')
        .where('item.isApproved = true');
      const countQb = this.updateRepository.createQueryBuilder('item')
        .where('item.isApproved = true');

      if (prefixTsQuery) {
        itemQb.andWhere(`to_tsvector(:config, coalesce(item.title, '') || ' ' || coalesce(item.content, '')) @@ to_tsquery(:config, :query)`, { config: textSearchConfig, query: prefixTsQuery });
        countQb.andWhere(`to_tsvector(:config, coalesce(item.title, '') || ' ' || coalesce(item.content, '')) @@ to_tsquery(:config, :query)`, { config: textSearchConfig, query: prefixTsQuery });
      }
      if (tags?.length) {
        itemQb.andWhere('item.tags && :tags', { tags });
        countQb.andWhere('item.tags && :tags', { tags });
      }
      if (dateStart) {
        itemQb.andWhere('item.createdAt >= :startDate', { startDate: dateStart });
        countQb.andWhere('item.createdAt >= :startDate', { startDate: dateStart });
      }
      if (dateEnd) {
        itemQb.andWhere('item.createdAt <= :endDate', { endDate: dateEnd });
        countQb.andWhere('item.createdAt <= :endDate', { endDate: dateEnd });
      }
      // Fetch all matching items, sort later
      itemPromises.push(itemQb.getMany());
      countPromises.push(countQb.getCount());
    } else {
      itemPromises.push(Promise.resolve([]));
      countPromises.push(Promise.resolve(0));
    }

    let galleryItems: GalleryItem[] = [];
    let eventItems: Event[] = [];
    let updateItems: Update[] = [];
    let counts: number[] = [];

    try {
      // Execute item fetches and count queries in parallel
      const results = await Promise.all([...itemPromises, ...countPromises]);
      const midPoint = results.length / 2;
      [galleryItems, eventItems, updateItems] = results.slice(0, midPoint) as [GalleryItem[], Event[], Update[]];
      counts = results.slice(midPoint) as number[];

    } catch (error: any) {
      if (error.message && error.message.includes('syntax error in tsquery')) {
        this.logger.error(`Search query failed due to tsquery syntax error. Original query: "${trimmedQuery}", Generated: "${prefixTsQuery}". Error: ${error.message}`, error.stack);
        throw new BadRequestException('Invalid search query format. Please try simplifying your search terms.');
      }
      this.logger.error(`Search query failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Search failed due to a database error.');
    }

    this.logger.debug(`Search Service - Fetched Gallery Items (before map): ${JSON.stringify(galleryItems.map(g => ({ id: g.id, thumbnailUrl: g.thumbnailUrl })), null, 2)}`);

    // --- Combine ALL fetched items ---
    const allCombinedItems: SearchResultItem[] = [
      ...galleryItems.map(item => ({
        id: item.id, type: SearchableItemType.Gallery, title: item.caption || 'Gallery Item',
        thumbnailUrl: item.thumbnailUrl, createdAt: item.uploadedAt, // Use the correct date field for sorting
        tags: item.tags, description: item.caption,
      })),
      ...eventItems.map(item => ({
        id: item.id, type: SearchableItemType.Event, title: item.title,
        description: item.description, createdAt: item.startDate, // ** IMPORTANT: Sort events by START DATE for relevance **
        tags: [],
      })),
      ...updateItems.map(item => ({
        id: item.id, type: SearchableItemType.Update, title: item.title,
        description: item.content.substring(0, 150) + (item.content.length > 150 ? '...' : ''),
        createdAt: item.createdAt, // Use the correct date field for sorting
        tags: item.tags,
      })),
    ];

    this.logger.debug(`Search Service - Combined Items (after map, before sort/slice): ${JSON.stringify(allCombinedItems.filter(i => i.type === SearchableItemType.Gallery).map(g => ({ id: g.id, thumbnailUrl: g.thumbnailUrl })), null, 2)}`);

    // --- Sort the ENTIRE combined list ---
    // Sort primarily by date DESC (newest first). Adjust date fields per type if needed.
    // Using `createdAt` as the common property after mapping. Be mindful of using the correct source date (uploadedAt, startDate, createdAt)
    allCombinedItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());


    // --- Calculate accurate total count ---
    const totalItems = counts.reduce((sum, count) => sum + count, 0);
    const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : (totalItems > 0 ? 1 : 0);

    // --- Apply pagination MANUALLY to the sorted combined list ---
    const paginatedItems = allCombinedItems.slice(skip, skip + limit);

    const response: PaginatedSearchResults = {
      items: paginatedItems,
      total: totalItems,
      page,
      limit,
      totalPages,
    };

    // --- Cache the successful result ---
    try {
      await this.cacheManager.set(cacheKey, JSON.stringify(response), this.CACHE_TTL_SECONDS * 1000);
      this.logger.debug(`Cached search results: ${cacheKey}`);
    } catch (cacheError: any) {
      this.logger.error(`Failed to cache search results for key ${cacheKey}: ${cacheError.message}`);
    }

    // --- Save search history ---
    if (user && trimmedQuery) {
      try {
        const historyEntry = this.searchHistoryRepository.create({ query: trimmedQuery, user });
        await this.searchHistoryRepository.save(historyEntry);
      } catch (histError: any) {
        this.logger.warn(`Failed to save search history for user ${user.id}: ${histError.message}`);
      }
    }

    return response;
  }

  async getAutocomplete(query: string): Promise<string[]> {
    this.logger.log(`Fetching autocomplete for query=${query}`);
    const trimmedQuery = query.trim();
    if (!trimmedQuery || trimmedQuery.length < 2) {
      return [];
    }

    const cacheKey = `autocomplete:${trimmedQuery.toLowerCase()}`;
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for autocomplete: ${cacheKey}`);
      try {
        return JSON.parse(cached);
      } catch (error) {
        this.logger.warn(`Bad autocomplete cache data for key ${cacheKey}: ${error}`);
        await this.cacheManager.del(cacheKey);
      }
    }
    this.logger.debug(`Cache miss for autocomplete: ${cacheKey}`);

    // Use ILike for simpler prefix/contains matching for autocomplete suggestions
    const searchTerm = `%${trimmedQuery}%`;
    const suggestionsSet = new Set<string>();
    type TagResult = { tag: string };

    try {
      // Using separate queries for simplicity and potential performance on indexed fields
      const [galleryTags, eventTitles, updateTitles, updateTags] = await Promise.all([
        // Suggest matching tags from Gallery
        this.galleryRepository.manager.query<TagResult[]>(
          `SELECT DISTINCT unnest(tags) as tag FROM gallery_item WHERE "isApproved" = true AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $1) LIMIT 5`,
          [searchTerm],
        ),
        // Suggest matching titles from Events
        this.eventRepository.find({
          select: ['title'],
          where: { title: ILike(searchTerm), status: Not(EventStatus.Cancelled) },
          take: 5,
          order: { title: 'ASC' }, // Optional: order alphabetically
        }),
        // Suggest matching titles from Updates
        this.updateRepository.find({
          select: ['title'],
          where: { title: ILike(searchTerm), isApproved: true },
          take: 5,
          order: { title: 'ASC' },
        }),
        // Suggest matching tags from Updates
        this.updateRepository.manager.query<TagResult[]>(
          `SELECT DISTINCT unnest(tags) as tag FROM update WHERE "isApproved" = true AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $1) LIMIT 5`,
          [searchTerm],
        ),
      ]);

      galleryTags.forEach(t => suggestionsSet.add(t.tag));
      eventTitles.forEach(e => suggestionsSet.add(e.title));
      updateTitles.forEach(u => suggestionsSet.add(u.title));
      updateTags.forEach(t => suggestionsSet.add(t.tag)); // Changed from t.term

    } catch (error: any) {
      this.logger.error(`Autocomplete query failed for term "${trimmedQuery}": ${error.message}`, error.stack);
      return []; // Return empty on error
    }

    const uniqueSuggestions = Array.from(suggestionsSet)
      .sort((a, b) => a.localeCompare(b)) // Sort alphabetically
      .slice(0, 10); // Limit total suggestions

    try {
      await this.cacheManager.set(cacheKey, JSON.stringify(uniqueSuggestions), this.CACHE_TTL_SECONDS * 1000);
      this.logger.debug(`Autocomplete generated and cached ${uniqueSuggestions.length} suggestions for "${trimmedQuery}".`);
    } catch (cacheError: any) {
      this.logger.error(`Failed to cache autocomplete results for key ${cacheKey}: ${cacheError.message}`);
    }


    return uniqueSuggestions;
  }

  async getSuggestions(user: User | null): Promise<SearchResultItem[]> {
    const userIdForLog = user?.id || 'guest';
    this.logger.log(`Fetching suggestions for userId=${userIdForLog}`);
    const cacheKey = `suggestions:${userIdForLog}`;
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for suggestions: ${cacheKey}`);
      try {
        return JSON.parse(cached);
      } catch (error) {
        this.logger.warn(`Bad suggestions cache data for key ${cacheKey}: ${error}`);
        await this.cacheManager.del(cacheKey);
      }
    }
    this.logger.debug(`Cache miss for suggestions: ${cacheKey}`);

    const suggestedItems: SearchResultItem[] = [];
    const fetchedIds = new Set<string>();
    const textSearchConfig = 'simple';

    // 1. Try suggestions based on user's recent search history (if logged in)
    if (user) {
      try {
        const history = await this.searchHistoryRepository.find({
          where: { user: { id: user.id } },
          order: { createdAt: 'DESC' },
          take: this.HISTORY_LIMIT,
          select: ['query'],
        });

        const recentTerms = [...new Set(history.map(h => h.query.trim()).filter(Boolean))];

        if (recentTerms.length > 0) {
          this.logger.debug(`Suggesting based on history terms for user ${user.id}: ${recentTerms.join(', ')}`);
          const latestTerm = recentTerms[0]; // Use the most recent search term

          // Fetch items related to the latest search term
          const [galleryBasedOnHistory, eventsBasedOnHistory, updatesBasedOnHistory] = await Promise.all([
            this.galleryRepository.createQueryBuilder('item')
              .where('item.isApproved = true')
              .andWhere(`item.searchVector @@ websearch_to_tsquery('${textSearchConfig}', :query)`, { query: latestTerm })
              .orderBy('item.uploadedAt', 'DESC')
              .take(3)
              .getMany(),
            this.eventRepository.createQueryBuilder('item')
              .where('item.status != :cancelled', { cancelled: EventStatus.Cancelled })
              .andWhere(`to_tsvector('${textSearchConfig}', item.title || ' ' || item.description) @@ websearch_to_tsquery('${textSearchConfig}', :query)`, { query: latestTerm })
              .orderBy('item.startDate', 'ASC') // Upcoming related events might be more relevant
              .take(2)
              .getMany(),
            this.updateRepository.createQueryBuilder('item')
              .where('item.isApproved = true')
              .andWhere(`to_tsvector('${textSearchConfig}', item.title || ' ' || item.content) @@ websearch_to_tsquery('${textSearchConfig}', :query)`, { query: latestTerm })
              .orderBy('item.createdAt', 'DESC')
              .take(2)
              .getMany(),
          ]);

          // Add results ensuring no duplicates and respecting the limit
          const addSuggestion = (item: SearchResultItem) => {
            if (!fetchedIds.has(item.id) && suggestedItems.length < this.SUGGESTIONS_LIMIT) {
              suggestedItems.push(item);
              fetchedIds.add(item.id);
            }
          };

          galleryBasedOnHistory.forEach(item => addSuggestion({
            id: item.id, type: SearchableItemType.Gallery, title: item.caption || 'Gallery Item',
            thumbnailUrl: item.thumbnailUrl, createdAt: item.uploadedAt, tags: item.tags, description: item.caption,
          }));
          eventsBasedOnHistory.forEach(item => addSuggestion({
            id: item.id, type: SearchableItemType.Event, title: item.title,
            description: item.description, createdAt: item.createdAt,
          }));
          updatesBasedOnHistory.forEach(item => addSuggestion({
            id: item.id, type: SearchableItemType.Update, title: item.title,
            description: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
            createdAt: item.createdAt, tags: item.tags,
          }));
        }
      } catch (error: any) {
        this.logger.error(`Error fetching history-based suggestions for user ${user.id}: ${error.message}`);
        // Proceed to fetch general suggestions
      }
    }

    // 2. Fill remaining slots with latest items if needed
    const remainingSlots = this.SUGGESTIONS_LIMIT - suggestedItems.length;
    if (remainingSlots > 0) {
      this.logger.debug(`Fetching ${remainingSlots} latest items as fallback/supplement.`);
      try {
        // Fetch a bit more than needed per type to allow for filtering duplicates
        const [latestGallery, latestEvents, latestUpdates] = await Promise.all([
          this.galleryRepository.find({
            where: { isApproved: true },
            order: { uploadedAt: 'DESC' },
            take: remainingSlots + 2, // Fetch slightly more to increase variety
          }),
          this.eventRepository.find({
            where: { status: Not(EventStatus.Cancelled) },
            order: { startDate: 'ASC' }, // Upcoming events first
            take: Math.max(1, Math.ceil(remainingSlots / 2)),
          }),
          this.updateRepository.find({
            where: { isApproved: true },
            order: { createdAt: 'DESC' },
            take: Math.max(1, Math.ceil(remainingSlots / 2)),
          }),
        ]);

        // Combine latest items, prioritize variety, avoid duplicates
        const latestCombined = [
          ...latestGallery.map(item => ({
            id: item.id,
            type: SearchableItemType.Gallery,
            title: item.caption || 'Gallery Item',
            thumbnailUrl: item.thumbnailUrl,
            createdAt: item.uploadedAt,
            tags: item.tags,
            description: item.caption,
          })),
          ...latestEvents.map(item => ({
            id: item.id,
            type: SearchableItemType.Event,
            title: item.title,
            description: item.description,
            createdAt: item.createdAt,
          })),
          ...latestUpdates.map(item => ({
            id: item.id,
            type: SearchableItemType.Update,
            title: item.title,
            description: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
            createdAt: item.createdAt,
            tags: item.tags,
          })),
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Sort all potential additions by date

        latestCombined.forEach(item => {
          if (!fetchedIds.has(item.id) && suggestedItems.length < this.SUGGESTIONS_LIMIT) {
            suggestedItems.push(item);
            fetchedIds.add(item.id);
          }
        });

      } catch (error: any) {
        this.logger.error(`Error fetching latest items for suggestions: ${error.message}`);
        // Proceed with whatever suggestions were gathered so far
      }
    }

    // Final sort and slice (although sorting primarily happened already)
    const finalSuggestions = suggestedItems
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, this.SUGGESTIONS_LIMIT);

    try {
      await this.cacheManager.set(cacheKey, JSON.stringify(finalSuggestions), this.CACHE_TTL_SECONDS * 1000);
      this.logger.debug(`Generated/cached ${finalSuggestions.length} suggestions for ${userIdForLog}.`);
    } catch (cacheError: any) {
      this.logger.error(`Failed to cache suggestion results for key ${cacheKey}: ${cacheError.message}`);
    }


    return finalSuggestions;
  }

  async downloadItem(user: User, itemType: string, itemId: string): Promise<string> {
    this.logger.log(`Download request: type=${itemType}, id=${itemId}, user=${user.id}`);

    const searchableItemType = itemType as SearchableItemType;

    if (searchableItemType === SearchableItemType.Gallery) {
      const item = await this.galleryRepository.findOne({ where: { id: itemId }, relations: ['uploadedBy'] });
      if (!item) throw new NotFoundException('Gallery item not found.');

      // Check access (Approved OR Admin/Staff OR Uploader)
      const canAccess = item.isApproved ||
        (user && (user.role === UserRole.Admin || user.role === UserRole.Staff)) ||
        (user && item.uploadedBy?.id === user.id);
      if (!canAccess) throw new ForbiddenException('Access denied to this gallery item.');
      if (!item.fileUrl) throw new NotFoundException('File URL is missing for this gallery item.');

      // Return only the filename, assuming the controller/service handles path construction
      return path.basename(item.fileUrl);

    } else if (searchableItemType === SearchableItemType.Update) {
      const item = await this.updateRepository.findOne({ where: { id: itemId }, relations: ['author'] });
      if (!item) throw new NotFoundException('Update item not found.');

      // Check access (Approved OR Admin/Staff OR Author)
      const canAccess = item.isApproved ||
        (user && (user.role === UserRole.Admin || user.role === UserRole.Staff)) ||
        (user && item.author?.id === user.id);
      if (!canAccess) throw new ForbiddenException('Access denied to this update item.');
      if (!item.attachmentUrls || item.attachmentUrls.length === 0) {
        throw new BadRequestException('This update has no attachments available for download.');
      }

      // Return only the filename of the *first* attachment
      return path.basename(item.attachmentUrls[0]);

    } else {
      throw new BadRequestException(`Downloads are not supported for item type: ${itemType}`);
    }
  }

  async getAttachmentStream(filename: string, res: Response): Promise<StreamableFile> {
    this.logger.log(`Attempting to get attachment stream for filename: ${filename}`);
    if (filename.startsWith('update-attachment-')) {
      try {
        return await this.updatesService.getAttachmentStream(filename, res);
      } catch (error) {
        if (error instanceof NotFoundException) {
          this.logger.warn(`Attachment ${filename} not found via UpdatesService.`);
        }
        throw error;
      }
    }

    try {
      return await this.galleryService.getAttachmentStream(filename, res);
    } catch (error) {
      this.logger.error(`Failed to get stream for ${filename} from any known source: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw new NotFoundException(`Attachment file '${filename}' not found.`);
      }
      throw new InternalServerErrorException('Could not stream the requested file.');
    }
  }

  downloadBulk(user: User, itemIds: { type: string; id: string }[]): string {
    this.logger.log(`Bulk download request received for ${itemIds.length} items from user ${user.id}.`);

    // Basic permission check
    if (user.role === UserRole.Visitor) {
      throw new ForbiddenException('Visitors are not permitted to perform bulk downloads.');
    }
    if (!itemIds || itemIds.length === 0) {
      throw new BadRequestException('No items were selected for bulk download.');
    }

    // Bulk download functionality is complex (fetching files, zipping, streaming).
    // Throwing NotImplementedException is appropriate until fully implemented.
    this.logger.warn(`Bulk download initiated by user ${user.id}, but the feature is not implemented.`);
    throw new NotImplementedException('Bulk download feature is not yet available.');
    // When implemented, this should initiate an async process and potentially return a job ID or status link.
  }

  async shareItem(user: User, itemType: SearchableItemType, itemId: string, platform: SharingPlatform): Promise<string> {
    this.logger.log(`Share request: type=${itemType}, id=${itemId}, platform=${platform}, user=${user?.id || 'guest'}`);

    const frontendBaseUrl = this.configService.get<string>('FRONTEND_URL');
    if (!frontendBaseUrl) {
      this.logger.error('FRONTEND_URL is not configured in environment variables.');
      throw new InternalServerErrorException('Sharing configuration error.');
    }

    let itemUrlPath: string | null = null;
    let itemTitle = 'Check this out'; // Default title

    try {
      if (itemType === SearchableItemType.Gallery) {
        const item = await this.galleryRepository.findOne({ where: { id: itemId, isApproved: true } });
        if (!item) throw new NotFoundException('Approved gallery item not found.');
        itemUrlPath = `/gallery/${item.id}`; // Example path, adjust as per frontend routing
        itemTitle = item.caption || 'Gallery Item';
      } else if (itemType === SearchableItemType.Event) {
        const item = await this.eventRepository.findOne({ where: { id: itemId, status: Not(EventStatus.Cancelled) } });
        if (!item) throw new NotFoundException('Active event not found.');
        itemUrlPath = `/events#${item.id}`; // Example path with hash, adjust as per frontend routing
        itemTitle = item.title;
      } else if (itemType === SearchableItemType.Update) {
        const item = await this.updateRepository.findOne({ where: { id: itemId, isApproved: true } });
        if (!item) throw new NotFoundException('Approved update not found.');
        itemUrlPath = `/updates/${item.id}`; // Example path, adjust as per frontend routing
        itemTitle = item.title;
      } else {
        throw new BadRequestException('Invalid item type specified for sharing.');
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error fetching item details for sharing (${itemType}/${itemId}): ${error.message}`);
      throw new InternalServerErrorException('Could not retrieve item details for sharing.');
    }


    const fullItemUrl = `${frontendBaseUrl}${itemUrlPath}`;
    let shareUrl = '';

    // Generate platform-specific share URL
    switch (platform) {
      case SharingPlatform.Twitter:
        shareUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(fullItemUrl)}&text=${encodeURIComponent(itemTitle)}`;
        break;
      case SharingPlatform.Facebook:
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullItemUrl)}`;
        break;
      case SharingPlatform.Whatsapp:
        // WhatsApp typically uses text format including the URL
        shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(itemTitle + ': ' + fullItemUrl)}`;
        break;
      default:
        this.logger.warn(`Unsupported sharing platform requested`);
        throw new BadRequestException(`Sharing via such platform is not supported.`);
    }

    this.logger.log(`Generated share URL for ${platform}: ${shareUrl}`);
    // Optionally: Log the share event
    // await this.logShareActivity(user, itemType, itemId, platform);

    return shareUrl;
  }

  async getShowcase(slug: string): Promise<{ slug: string, items: SearchResultItem[] }> {
    this.logger.log(`Fetching showcase content for slug: ${slug}`);

    let showcaseItems: SearchResultItem[] = [];

    // Example showcase: Homepage Gallery featuring specific tags
    if (slug === 'homepage-gallery') {
      try {
        const galleryItems = await this.galleryRepository.find({
          where: {
            tags: ['featured', 'homepage'] as any, // Adjust tags as needed
            isApproved: true,
          },
          take: 6, // Limit the number of items
          order: { uploadedAt: 'DESC' }, // Show newest first
        });

        showcaseItems = galleryItems.map(item => ({
          id: item.id,
          type: SearchableItemType.Gallery,
          title: item.caption || 'Featured Gallery Item',
          thumbnailUrl: item.thumbnailUrl,
          createdAt: item.uploadedAt,
          tags: item.tags,
          description: item.caption,
        }));
      } catch (error: any) {
        this.logger.error(`Failed to fetch items for showcase "${slug}": ${error.message}`);
        throw new InternalServerErrorException(`Could not load showcase: ${slug}`);
      }

    }
      // Add more `else if (slug === '...')` blocks for other showcases
    // e.g., upcoming events, recent news updates
    else {
      throw new NotFoundException(`Showcase definition for slug "${slug}" not found.`);
    }

    this.logger.log(`Returning ${showcaseItems.length} items for showcase "${slug}".`);
    return { slug, items: showcaseItems };
  }

  async createAnnotation(user: User, itemType: SearchableItemType, itemId: string, content: string): Promise<Annotation> {
    this.logger.log(`Annotation creation attempt: type=${itemType}, id=${itemId}, user=${user.id}`);

    // Permission check: Only registered users (non-visitors) can annotate
    if (!user || user.role === UserRole.Visitor) {
      throw new ForbiddenException('You must be logged in to add annotations.');
    }
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Annotation content cannot be empty.');
    }

    // Verify the target item exists and is accessible (approved/active)
    let itemExists = false;
    try {
      switch (itemType) {
        case SearchableItemType.Gallery:
          itemExists = !!await this.galleryRepository.count({ where: { id: itemId, isApproved: true } });
          break;
        case SearchableItemType.Event:
          itemExists = !!await this.eventRepository.count({
            where: {
              id: itemId,
              status: Not(EventStatus.Cancelled),
            },
          });
          break;
        case SearchableItemType.Update:
          itemExists = !!await this.updateRepository.count({ where: { id: itemId, isApproved: true } });
          break;
        default:
          throw new BadRequestException('Invalid item type provided for annotation.');
      }
    } catch (error: any) {
      this.logger.error(`Error verifying item existence for annotation (${itemType}/${itemId}): ${error.message}`);
      throw new InternalServerErrorException('Failed to verify item for annotation.');
    }

    if (!itemExists) {
      throw new NotFoundException(`The target ${itemType} item (ID: ${itemId}) was not found or is not currently accessible.`);
    }

    // Determine initial approval status based on user role
    const isApproved = user.role === UserRole.Admin || user.role === UserRole.Staff;

    const annotation = this.annotationRepository.create({
      content: content.trim(),
      itemType,
      itemId,
      createdBy: user,
      isApproved: isApproved, // Auto-approve for Admin/Staff
    });

    try {
      const savedAnnotation = await this.annotationRepository.save(annotation);
      this.logger.log(`Annotation created (ID: ${savedAnnotation.id}), approved: ${isApproved}`);
      // Optionally: Clear relevant caches if annotations are displayed directly
      // await this.cacheManager.del(`annotations:${itemType}:${itemId}`);
      return savedAnnotation;
    } catch (error: any) {
      this.logger.error(`Failed to save annotation for user ${user.id} on ${itemType}/${itemId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Could not save the annotation due to a server error.');
    }
  }

  async getAnnotations(itemType: SearchableItemType, itemId: string): Promise<Annotation[]> {
    this.logger.log(`Fetching approved annotations for: type=${itemType}, id=${itemId}`);

    // Basic validation
    if (!Object.values(SearchableItemType).includes(itemType)) {
      throw new BadRequestException('Invalid item type specified.');
    }

    const cacheKey = `annotations:${itemType}:${itemId}`;
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for annotations: ${cacheKey}`);
      try {
        // Need to properly deserialize user object if it's complex
        const parsedAnnotations = JSON.parse(cached, (key, value) => {
          if (key === 'createdAt' || key === 'updatedAt') return new Date(value); // Revive dates
          return value;
        });
        return parsedAnnotations as Annotation[];
      } catch (error) {
        this.logger.warn(`Bad annotations cache data for key ${cacheKey}: ${error}`);
        await this.cacheManager.del(cacheKey);
      }
    }
    this.logger.debug(`Cache miss for annotations: ${cacheKey}`);


    try {
      const annotations = await this.annotationRepository.find({
        where: {
          itemType: itemType,
          itemId: itemId,
          isApproved: true, // Only fetch approved annotations
        },
        relations: {
          createdBy: true, // Eagerly load the user who created it
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          itemType: true,
          itemId: true,
          isApproved: true,
          createdBy: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
        order: {
          createdAt: 'ASC',
        },
      });

      this.logger.log(`Found ${annotations.length} approved annotations for ${itemType}/${itemId}.`);

      try {
        await this.cacheManager.set(cacheKey, JSON.stringify(annotations), this.CACHE_TTL_SECONDS * 1000); // Cache for 5 mins
        this.logger.debug(`Cached annotations result: ${cacheKey}`);
      } catch (cacheError: any) {
        this.logger.error(`Failed to cache annotations for key ${cacheKey}: ${cacheError.message}`);
      }

      return annotations;

    } catch (error: any) {
      this.logger.error(`Error fetching approved annotations for ${itemType}/${itemId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Could not retrieve annotations at this time.');
    }
  }
}

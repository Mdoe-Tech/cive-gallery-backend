import { Injectable, BadRequestException, NotFoundException, Logger, ForbiddenException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, FindOptionsWhere } from 'typeorm';
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
import { Notification } from '../notifications/entities/notification.entity';

type ItemType = 'gallery' | 'event' | 'update';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(GalleryItem)
    private galleryRepository: Repository<GalleryItem>,
    @InjectRepository(Event)
    private eventRepository: Repository<Event>,
    @InjectRepository(Update)
    private updateRepository: Repository<Update>,
    @InjectRepository(SearchHistory)
    private searchHistoryRepository: Repository<SearchHistory>,
    @InjectRepository(ShareLink)
    private shareLinkRepository: Repository<ShareLink>,
    @InjectRepository(Annotation)
    private annotationRepository: Repository<Annotation>,
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {
    this.logger.log('SearchService initialized');
  }

  async search(
    user: User | null,
    params: {
      query?: string;
      tags?: string[];
      types?: string[];
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
      skipCache?: boolean;
    },
  ): Promise<any> {
    const { query, tags, types, startDate, endDate, page = 1, limit = 10, skipCache = false } = params;
    this.logger.log(`Searching: query=${query}, userId=${user?.id}`);

    const cacheKey = `search:${user?.id || 'guest'}:${JSON.stringify(params)}`;
    if (!skipCache) {
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${cacheKey}`);
        return JSON.parse(cached as string);
      }
    }

    const results: { gallery: any[]; events: any[]; updates: any[] } = { gallery: [], events: [], updates: [] };
    const offset = (page - 1) * limit;

    if (query) {
      if (types?.includes('gallery') || !types) {
        const galleryQuery = this.galleryRepository
          .createQueryBuilder('gallery')
          .where('gallery.isApproved = :isApproved', { isApproved: true })
          .andWhere('gallery.searchVector @@ to_tsquery(:query)', { query: query.replace(/\s+/g, ' & ') });
        if (tags?.length) galleryQuery.andWhere('gallery.tags && :tags', { tags });
        results.gallery = await galleryQuery.skip(offset).take(limit).getMany();
      }

      if (types?.includes('event') || !types) {
        const eventQuery = this.eventRepository
          .createQueryBuilder('event')
          .where('event.status != :cancelled', { cancelled: EventStatus.Cancelled })
          .andWhere('to_tsvector(event.title || \' \' || event.description) @@ to_tsquery(:query)', {
            query: query.replace(/\s+/g, ' & '),
          });

        // Handle date filtering if provided
        if (startDate && endDate) {
          eventQuery.andWhere('event.startDate BETWEEN :startDate AND :endDate', { startDate, endDate });
        }

        results.events = await eventQuery.skip(offset).take(limit).getMany();
      }

      if (types?.includes('update') || !types) {
        const updateQuery = this.updateRepository
          .createQueryBuilder('update')
          .where('update.isApproved = :isApproved', { isApproved: true })
          .andWhere('to_tsvector(update.title || \' \' || update.content) @@ to_tsquery(:query)', {
            query: query.replace(/\s+/g, ' & '),
          });
        if (tags?.length) updateQuery.andWhere('update.tags && :tags', { tags });
        results.updates = await updateQuery.skip(offset).take(limit).getMany();
      }
    } else {
      if (types?.includes('gallery') || !types) {
        const galleryQuery = this.galleryRepository
          .createQueryBuilder('gallery')
          .where('gallery.isApproved = :isApproved', { isApproved: true });
        if (tags?.length) galleryQuery.andWhere('gallery.tags && :tags', { tags });
        results.gallery = await galleryQuery.skip(offset).take(limit).getMany();
      }

      if (types?.includes('event') || !types) {
        const eventQuery = this.eventRepository
          .createQueryBuilder('event')
          .where('event.status != :cancelled', { cancelled: EventStatus.Cancelled });

        // Handle date filtering if provided
        if (startDate && endDate) {
          eventQuery.andWhere('event.startDate BETWEEN :startDate AND :endDate', { startDate, endDate });
        }

        results.events = await eventQuery.skip(offset).take(limit).getMany();
      }

      if (types?.includes('update') || !types) {
        const updateQuery = this.updateRepository
          .createQueryBuilder('update')
          .where('update.isApproved = :isApproved', { isApproved: true });
        if (tags?.length) updateQuery.andWhere('update.tags && :tags', { tags });
        results.updates = await updateQuery.skip(offset).take(limit).getMany();
      }
    }

    if (!results.gallery.length && !results.events.length && !results.updates.length) {
      this.logger.warn(`No results for query=${query}`);
      throw new NotFoundException('No results found. Try broader terms.');
    }

    const response = {
      items: [
        ...results.gallery.map(item => ({ type: 'gallery', ...item })),
        ...results.events.map(item => ({ type: 'event', ...item })),
        ...results.updates.map(item => ({ type: 'update', ...item })),
      ],
      total: results.gallery.length + results.events.length + results.updates.length,
      page,
      limit,
    };

    await this.cacheManager.set(cacheKey, JSON.stringify(response), 300 * 1000);
    this.logger.debug(`Cached: ${cacheKey}`);

    if (user && query) {
      const history = this.searchHistoryRepository.create({ query, user });
      await this.searchHistoryRepository.save(history);
      this.logger.log(`Saved search history: userId=${user.id}, query=${query}`);
    }

    return response;
  }

  async getAutocomplete(query: string): Promise<string[]> {
    this.logger.log(`Fetching autocomplete for query=${query}`);
    const cacheKey = `autocomplete:${query.toLowerCase()}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached as string);
    }

    const suggestions: string[] = [];
    const terms = query.split(/\s+/).filter(t => t.length > 1);

    if (terms.length) {
      // 1. Gallery tags
      const galleryTags = await this.galleryRepository.manager.query(
        `
        SELECT DISTINCT tag
        FROM (
          SELECT unnest(tags) as tag
          FROM gallery_item
          WHERE "isApproved" = true
        ) t
        WHERE tag ILIKE ANY($1)
        ORDER BY tag
        LIMIT 5
        `,
        [terms.map(t => `%${t}%`)],
      );

      // 2. Event titles
      const eventTitles = await this.eventRepository
        .createQueryBuilder('event')
        .select('event.title')
        .where('event.title ILIKE ANY(:terms)', { terms: terms.map(t => `%${t}%`) })
        .andWhere('event.status != :cancelled', { cancelled: 'Cancelled' })
        .orderBy('event.title')
        .limit(5)
        .getMany();

      // 3. Update titles and tags
      const updateTerms = await this.updateRepository.manager.query(
        `
        SELECT DISTINCT term
        FROM (
          SELECT title as term
          FROM update
          WHERE "isApproved" = true
          UNION
          SELECT unnest(tags) as term
          FROM update
          WHERE "isApproved" = true
        ) t
        WHERE term ILIKE ANY($1)
        ORDER BY term
        LIMIT 5
        `,
        [terms.map(t => `%${t}%`)],
      );

      // 4. Notification messages
      const notificationMessages = await this.notificationRepository
        .createQueryBuilder('notification')
        .select('notification.message')
        .where('notification.message ILIKE ANY(:terms)', { terms: terms.map(t => `%${t}%`) })
        .orderBy('notification.message')
        .limit(5)
        .getMany();

      suggestions.push(
        ...galleryTags.map(t => t.tag),
        ...eventTitles.map(e => e.title),
        ...updateTerms.map(t => t.term),
        ...notificationMessages.map(n => n.message),
      );
    }

    const uniqueSuggestions = [...new Set(suggestions)]
      .filter(s => s && s.trim().length > 0)
      .slice(0, 10);
    await this.cacheManager.set(cacheKey, JSON.stringify(uniqueSuggestions), 300 * 1000);
    this.logger.debug(`Cached: ${cacheKey} with ${uniqueSuggestions.length} suggestions`);
    return uniqueSuggestions;
  }

  async getSuggestions(user: User | null): Promise<any[]> {
    this.logger.log(`Fetching suggestions for userId=${user?.id || 'guest'}`);
    const cacheKey = `suggestions:${user?.id || 'guest'}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached as string);
    }

    const items: any[] = [];
    if (user) {
      const history = await this.searchHistoryRepository.find({
        where: { user: { id: user.id } },
        order: { createdAt: 'DESC' },
        take: 5,
      });

      if (history.length) {
        const queries = history.map(h => h.query);
        const gallery = await this.galleryRepository
          .createQueryBuilder('gallery')
          .where('gallery.isApproved = :isApproved', { isApproved: true })
          .andWhere('gallery.searchVector @@ to_tsquery(:query)', { query: queries.join(' | ') })
          .take(3)
          .getMany();

        const events = await this.eventRepository
          .createQueryBuilder('event')
          .where('event.status != :cancelled', { cancelled: EventStatus.Cancelled })
          .andWhere('to_tsvector(event.title || \' \' || event.description) @@ to_tsquery(:query)', {
            query: queries.join(' | '),
          })
          .take(3)
          .getMany();

        const updates = await this.updateRepository
          .createQueryBuilder('update')
          .where('update.isApproved = :isApproved', { isApproved: true })
          .andWhere('to_tsvector(update.title || \' \' || update.content) @@ to_tsquery(:query)', {
            query: queries.join(' | '),
          })
          .take(3)
          .getMany();

        items.push(
          ...gallery.map(g => ({ type: 'gallery', ...g })),
          ...events.map(e => ({ type: 'event', ...e })),
          ...updates.map(u => ({ type: 'update', ...u })),
        );
      }
    }

    if (items.length < 5) {
      const trendingGallery = await this.galleryRepository
        .createQueryBuilder('gallery')
        .where('gallery.isApproved = :isApproved', { isApproved: true })
        .orderBy('gallery.uploadedAt', 'DESC')
        .take(3)
        .getMany();

      const trendingEvents = await this.eventRepository
        .createQueryBuilder('event')
        .where('event.status != :cancelled', { cancelled: EventStatus.Cancelled })
        .orderBy('event.createdAt', 'DESC')
        .take(3)
        .getMany();

      items.push(
        ...trendingGallery.map(g => ({ type: 'gallery', ...g })),
        ...trendingEvents.map(e => ({ type: 'event', ...e })),
      );
    }

    const response = items.slice(0, 10);
    await this.cacheManager.set(cacheKey, JSON.stringify(response), 300 * 1000);
    this.logger.debug(`Cached: ${cacheKey}`);
    return response;
  }

  async downloadItem(user: User, itemType: string, itemId: string): Promise<string> {
    this.logger.log(`Downloading item: type=${itemType}, id=${itemId}, userId=${user.id}`);
    if (user.role === UserRole.Visitor) {
      this.logger.warn(`Unauthorized download attempt by visitor: userId=${user.id}`);
      throw new ForbiddenException('Visitors cannot download content');
    }

    if (itemType !== 'gallery') {
      this.logger.warn(`Invalid download type: ${itemType}`);
      throw new BadRequestException('Only gallery items are downloadable');
    }

    const item = await this.galleryRepository.findOne({ where: { id: itemId, isApproved: true } });
    if (!item || !item.fileUrl) {
      this.logger.warn(`Item not found or no file: type=${itemType}, id=${itemId}`);
      throw new NotFoundException('Item not found or no downloadable file');
    }

    this.logger.log(`Returning file URL for download: ${item.fileUrl}`);
    return item.fileUrl;
  }

  async downloadBulk(user: User, itemIds: { type: string; id: string }[]): Promise<string> {
    this.logger.log(`Bulk downloading ${itemIds.length} items for userId=${user.id}`);
    if (user.role === UserRole.Visitor) {
      this.logger.warn(`Unauthorized bulk download attempt by visitor: userId=${user.id}`);
      throw new ForbiddenException('Visitors cannot download content');
    }

    const urls: string[] = [];
    let estimatedSize = 0;

    for (const { type, id } of itemIds) {
      if (type !== 'gallery') continue;
      const item = await this.galleryRepository.findOne({ where: { id, isApproved: true } });
      if (item && item.fileUrl) {
        urls.push(item.fileUrl);
        estimatedSize += 50 * 1024 * 1024;
      }
    }

    if (estimatedSize > 500 * 1024 * 1024) {
      this.logger.warn(`Bulk download exceeds 500MB: size=${estimatedSize}`);
      throw new BadRequestException('Bulk download exceeds 500MB limit');
    }

    if (!urls.length) {
      this.logger.warn(`No valid files for bulk download`);
      throw new NotFoundException('No downloadable files');
    }

    const zipUrl = `/downloads/bulk-${Date.now()}.zip`;
    this.logger.log(`Generated bulk download URL: ${zipUrl}`);
    return zipUrl;
  }

  async shareItem(user: User, itemType: string, itemId: string, platform: string): Promise<string> {
    this.logger.log(`Sharing item: type=${itemType}, id=${itemId}, platform=${platform}, userId=${user.id}`);
    let text = '';
    let shareUrl = '';

    if (itemType === 'gallery') {
      const item = await this.galleryRepository.findOne({ where: { id: itemId, isApproved: true } });
      if (!item) {
        throw new NotFoundException('Gallery item not found');
      }
      text = item.caption || 'Shared from CIVE Gallery';
      shareUrl = `http://cive.ac.tz/share/gallery/${itemId}`;
    } else if (itemType === 'event') {
      const item = await this.eventRepository.findOne({ where: { id: itemId } });
      if (!item) {
        throw new NotFoundException('Event not found');
      }
      text = item.title || 'Shared from CIVE Gallery';
      shareUrl = `http://cive.ac.tz/share/event/${itemId}`;
    } else {
      throw new BadRequestException('Invalid item type');
    }

    let url = '';
    if (platform === 'twitter') {
      url = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
    } else {
      throw new BadRequestException('Unsupported platform');
    }

    this.logger.debug(`Share URL: ${url}`);
    return url;
  }

  async getShowcase(slug: string): Promise<any> {
    this.logger.log(`Fetching showcase: slug=${slug}`);
    const cacheKey = `showcase:${slug}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached as string);
    }

    const items: any[] = [];
    const normalizedSlug = slug.toLowerCase();
    if (['team', 'assets'].includes(normalizedSlug)) {
      const galleryItems = await this.galleryRepository
        .createQueryBuilder('gallery')
        .where('gallery.tags @> ARRAY[:tag]::text[]', { tag: normalizedSlug })
        .andWhere('gallery.isApproved = :isApproved', { isApproved: true })
        .take(10)
        .getMany();

      const events = await this.eventRepository
        .createQueryBuilder('event')
        .where('event.status != :cancelled', { cancelled: EventStatus.Cancelled })
        .andWhere('event.title ILIKE :slug', { slug: `%${normalizedSlug}%` })
        .take(5)
        .getMany();

      items.push(
        ...galleryItems.map(g => ({ type: 'gallery', ...g })),
        ...events.map(e => ({ type: 'event', ...e })),
      );
    }

    if (!items.length) {
      this.logger.warn(`No items for showcase: slug=${slug}`);
      throw new NotFoundException('Showcase not found');
    }

    const response = {
      slug,
      items,
    };

    await this.cacheManager.set(cacheKey, JSON.stringify(response), 300 * 1000);
    this.logger.debug(`Cached: ${cacheKey}`);
    return response;
  }

  async createAnnotation(user: User, itemType: ItemType, itemId: string, content: string): Promise<Annotation> {
    this.logger.log(`Creating annotation: type=${itemType}, id=${itemId}, userId=${user.id}`);
    if (user.role === UserRole.Visitor) {
      this.logger.warn(`Unauthorized annotation attempt by visitor: userId=${user.id}`);
      throw new ForbiddenException('Visitors cannot annotate content');
    }

    let item: any;
    if (itemType === 'gallery') {
      item = await this.galleryRepository.findOne({ where: { id: itemId, isApproved: true } });
    } else if (itemType === 'event') {
      item = await this.eventRepository.findOne({
        where: {
          id: itemId,
          status: Not(EventStatus.Cancelled),
        },
      });
    } else if (itemType === 'update') {
      item = await this.updateRepository.findOne({ where: { id: itemId, isApproved: true } });
    } else {
      throw new BadRequestException('Invalid item type');
    }

    if (!item) {
      this.logger.warn(`Item not found for annotation: type=${itemType}, id=${itemId}`);
      throw new NotFoundException('Item not found');
    }

    // Create the where condition with correct typing
    const whereCondition: FindOptionsWhere<Annotation> = {
      itemType,
      itemId,
    };

    const count = await this.annotationRepository.count({ where: whereCondition });
    if (count >= 1000) {
      this.logger.warn(`Annotation limit reached: type=${itemType}, id=${itemId}`);
      throw new BadRequestException('Annotation limit reached');
    }

    const annotation = this.annotationRepository.create({
      content,
      itemType,
      itemId,
      createdBy: user,
      isApproved: user.role === UserRole.Admin || user.role === UserRole.Staff,
    });

    const savedAnnotation = await this.annotationRepository.save(annotation);
    this.logger.log(`Created annotation: id=${savedAnnotation.id}`);
    return savedAnnotation;
  }

  async getAnnotations(itemType: ItemType, itemId: string): Promise<Annotation[]> {
    this.logger.log(`Fetching annotations: type=${itemType}, id=${itemId}`);

    // Create the where condition with correct typing
    const whereCondition: FindOptionsWhere<Annotation> = {
      itemType,
      itemId,
      isApproved: true,
    };

    const annotations = await this.annotationRepository.find({
      where: whereCondition,
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
    });

    this.logger.log(`Fetched ${annotations.length} annotations`);
    return annotations;
  }
}

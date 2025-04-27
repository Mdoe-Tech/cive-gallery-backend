// src/search/entities/annotation.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { SearchableItemType } from '../dto/search-query.dto';

@Entity()
export class Annotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  content: string;

  @Column({ type: 'enum', enum: SearchableItemType })
  itemType: SearchableItemType;

  @Column('uuid')
  itemId: string;

  @Column({ default: false })
  isApproved: boolean;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ManyToOne(() => User, { eager: false, onDelete: 'SET NULL', nullable: true })
  createdBy: User | null;

  @Column('uuid', { nullable: true })
  createdById: string | null;
}

import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, Index } from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity()
@Index('idx_tags', ['tags'])
@Index('idx_uploaded_at', ['uploadedAt'])
@Index('idx_is_approved', ['isApproved'])
export class GalleryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fileUrl: string;

  @Column()
  caption: string;

  @Column('text', { array: true, default: '{}' })
  tags: string[];

  @Column({ default: false })
  isApproved: boolean;

  @ManyToOne(() => User, (user) => user.id)
  uploadedBy: User;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  uploadedAt: Date;

  @Column()
  mimeType: string;

  @Column({ nullable: true })
  thumbnailUrl: string;

  @Column({ default: 0 })
  viewCount: number;

  @Column({ type: 'tsvector', nullable: true })
  searchVector: string;
}

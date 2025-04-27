import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { User } from '../../auth/entities/user.entity';

@Entity()
export class Update {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column('text')
  content: string;

  @Column('text', { array: true, default: () => '\'{}\'' })
  tags: string[];

  @Column('text', {
    array: true,
    nullable: true,
    default: () => '\'{}\'',
    comment: 'Array of URLs pointing to attached files/images',
  })
  attachmentUrls: string[];

  @Column({ default: false })
  isApproved: boolean;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @ManyToOne('User', 'updates', { eager: true, onDelete: 'SET NULL', nullable: true })
  author: User | null;
}

import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import type { User } from '../../auth/entities/user.entity';

@Entity()
export class Update {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column('text')
  content: string;

  @Column('text', { array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ default: false })
  isApproved: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @ManyToOne('User', 'updates', { eager: true })
  author: User;
}

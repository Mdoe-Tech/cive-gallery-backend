import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity()
export class Annotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  content: string;

  @Column()
  itemType: 'gallery' | 'event' | 'update';

  @Column()
  itemId: string;

  @Column({ default: false })
  isApproved: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ManyToOne(() => User)
  createdBy: User;
}

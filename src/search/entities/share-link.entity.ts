import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity()
export class ShareLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  url: string;

  @Column()
  itemType: 'gallery' | 'event' | 'update';

  @Column()
  itemId: string;

  @Column()
  platform: 'twitter' | 'facebook' | 'whatsapp';

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => "CURRENT_TIMESTAMP + INTERVAL '30 days'" })
  expiresAt: Date;

  @ManyToOne(() => User)
  createdBy: User;
}

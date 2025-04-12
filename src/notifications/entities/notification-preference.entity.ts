import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { NotificationType } from './notification.entity';

@Entity()
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User)
  @JoinColumn()
  user: User;

  @Column({ type: 'json', default: {} })
  channels: {
    [key in NotificationType]?: { inApp: boolean; email: boolean };
  };

  @Column({ type: 'json', default: [] })
  categories: string[];
}

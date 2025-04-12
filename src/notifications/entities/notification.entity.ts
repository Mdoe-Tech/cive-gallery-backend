import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export enum NotificationType {
  NewContent = 'NewContent',
  Approval = 'Approval',
  Update = 'Update',
  Event = 'Event',
  Emergency = 'Emergency',
}

@Entity()
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  message: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ nullable: true })
  referenceId?: string;

  @Column({ default: false })
  isRead: boolean;

  @ManyToOne(() => User, { eager: true })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}

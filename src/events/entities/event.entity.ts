import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import type { IUser } from '../../common/interfaces/entities.interface';
import { User } from '../../auth/entities/user.entity';

export enum EventStatus {
  Upcoming = 'Upcoming',
  Ongoing = 'Ongoing',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
}

@Entity()
export class Event {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  description: string;

  @Column()
  startDate: Date;

  @Column({ nullable: true })
  endDate?: Date;

  @Column({ nullable: true })
  location?: string;

  @Column()
  organizer: string;

  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.Upcoming })
  status: EventStatus;

  @ManyToOne(() => User, (user) => user.events, { eager: true })
  createdBy: IUser;

  @CreateDateColumn()
  createdAt: Date;
}

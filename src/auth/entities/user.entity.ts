import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Update } from '../../updates/entities/update.entity';
import { Event } from '../../events/entities/event.entity';
import { IUser, UserRole } from '../../common/interfaces/entities.interface';

@Entity()
export class User implements IUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.Student })
  role: UserRole;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true })
  bio: string;

  @Column({ nullable: true })
  fullName: string;

  @OneToMany(() => Update, (update) => update.author)
  updates: Update[];

  @OneToMany(() => Event, (event) => event.createdBy)
  events: Event[];
}

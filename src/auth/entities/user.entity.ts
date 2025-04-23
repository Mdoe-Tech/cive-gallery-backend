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

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  fullName: string | null;

  @OneToMany(() => Update, (update) => update.author)
  updates: Update[];

  @OneToMany(() => Event, (event) => event.createdBy)
  events: Event[];
}

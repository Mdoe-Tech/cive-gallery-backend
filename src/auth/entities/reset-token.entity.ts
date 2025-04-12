import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class ResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  token: string;

  @ManyToOne(() => User, (user) => user.id)
  user: User;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}

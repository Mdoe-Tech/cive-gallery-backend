import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity()
export class SearchHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  query: string;

  @ManyToOne(() => User)
  user: User;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

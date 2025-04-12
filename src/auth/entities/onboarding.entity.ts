import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Onboarding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  role: string;

  @Column('text')
  content: string;
}

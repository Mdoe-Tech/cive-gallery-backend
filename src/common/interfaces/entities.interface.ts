import type { User } from '../../auth/entities/user.entity';

export enum UserRole {
  Admin = 'Admin',
  Student = 'Student',
  Staff = 'Staff',
  Visitor = 'Visitor',
}

export interface IUser {
  id: string;
  email: string;
  password: string | null;
  role: UserRole;
  avatar: string | null;
  bio: string | null;
  fullName: string | null;
}

export interface IEvent {
  id: string;
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
  location?: string;
  organizer: string;
  status: 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled';
  createdBy: IUser;
  createdAt: Date;
}

export interface IUpdate {
  id: string;
  title: string;
  content: string;
  tags: string[];
  isApproved: boolean;
  author: User;
}

import * as express from 'express';
import { User } from '../../auth/entities/user.entity';

export interface AuthenticatedRequest extends express.Request {
  user: User;
} 
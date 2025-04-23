// src/auth/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../common/interfaces/entities.interface';

export const ROLES_KEY = 'roles'; // Key to store roles metadata

/**
 * Decorator to specify which roles are allowed to access a route.
 * Use with RolesGuard.
 * @param roles - An array of UserRole enum values.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

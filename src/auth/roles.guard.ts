// src/auth/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from '../common/interfaces/entities.interface';
import { User } from './entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Get required roles from @Roles() decorator metadata
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(), // Check method decorator first
      context.getClass(),   // Then check class decorator
    ]);

    // 2. If no roles are required, allow access (guard passes)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 3. Get the user object from the request
    // This assumes JwtAuthGuard has run before this guard and attached the user
    const request = context.switchToHttp().getRequest();
    const user = request.user as User; // Type assertion, assumes user is attached

    // 4. If no user object is found (e.g., JwtAuthGuard failed or wasn't used), deny access
    if (!user || !user.role) {
      return false;
    }

    // 5. Check if the user's role is included in the required roles
    // Use .some() for efficiency - stop as soon as a match is found
    return requiredRoles.some((role) => user.role === role);
  }
}

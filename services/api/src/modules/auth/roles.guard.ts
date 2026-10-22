import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "./auth.types.js";
import { ROLES_KEY } from "./roles.decorator.js";
import type { AuthenticatedRequest } from "./session.guard.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = request.authSession?.user.roles ?? [];
    if (required.some((role) => roles.includes(role))) return true;
    throw new ForbiddenException("You do not have permission to perform this action.");
  }
}

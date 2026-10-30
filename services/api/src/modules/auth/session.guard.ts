import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthService } from "./auth.service.js";
import type { AuthSession } from "./auth.types.js";

export type AuthenticatedRequest = FastifyRequest & { authSession?: AuthSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token || token.length < 32) throw new UnauthorizedException("A valid bearer session is required.");
    request.authSession = await this.authService.authenticate(token);
    return true;
  }
}

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token || token.length < 32) return true;
    try {
      request.authSession = await this.authService.authenticate(token);
    } catch {
      // Invalid optional sessions are treated as anonymous visitors.
    }
    return true;
  }
}

function bearerToken(request: AuthenticatedRequest): string | null {
  const authorization = request.headers.authorization;
  return typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

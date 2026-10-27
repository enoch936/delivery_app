import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

export const RATE_LIMIT_KEY = "rateLimit";

export type RateLimitConfig = {
  points: number;
  durationSeconds: number;
  keyPrefix?: string;
};

export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);

type Entry = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.getAllAndOverride<RateLimitConfig | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!config) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest & { authSession?: { user: { id: string } } }>();
    const key = `${config.keyPrefix ?? "rl"}:${request.authSession?.user.id ?? request.ip ?? "anon"}:${context.getClass().name}.${context.getHandler().name}`;
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= now) {
      this.store.set(key, { count: 1, resetAt: now + config.durationSeconds * 1000 });
      return true;
    }
    if (entry.count >= config.points) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many requests. Please retry later.",
          error: "RateLimitExceeded"
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    entry.count += 1;
    return true;
  }
}

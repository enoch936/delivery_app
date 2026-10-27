import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../modules/auth/session.guard.js";

export function requireUser(request: AuthenticatedRequest): NonNullable<AuthenticatedRequest["authSession"]>["user"] {
  const user = request.authSession?.user;
  if (!user) throw new ForbiddenException("An authenticated session is required.");
  return user;
}

export function hashIp(ipAddress: string | null | undefined): string | null {
  return ipAddress ? createHash("sha256").update(ipAddress).digest("hex") : null;
}

export function requestId(request: { headers: Record<string, unknown> }): string | null {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : null;
}

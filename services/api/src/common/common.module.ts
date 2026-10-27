import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditService } from "./audit.service.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

@Global()
@Module({
  providers: [
    AuditService
  ],
  exports: [AuditService]
})
export class CommonModule {}



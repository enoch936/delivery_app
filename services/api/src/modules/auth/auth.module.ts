import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { IDENTITY_REPOSITORY, OTP_PROVIDER, RUNTIME_CONFIG } from "./auth.types.js";
import { DevelopmentOtpProvider, DisabledOtpProvider } from "./otp.provider.js";
import { PostgresIdentityRepository } from "./postgres-identity.repository.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    RolesGuard,
    PostgresIdentityRepository,
    { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig },
    { provide: IDENTITY_REPOSITORY, useExisting: PostgresIdentityRepository },
    {
      provide: OTP_PROVIDER,
      useFactory: () => readRuntimeConfig().otpProvider === "development" ? new DevelopmentOtpProvider() : new DisabledOtpProvider()
    }
  ],
  exports: [AuthService, SessionGuard, RolesGuard]
})
export class AuthModule {}

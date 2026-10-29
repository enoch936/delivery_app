import { Body, Controller, Get, Headers, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit.guard.js";
import { UsersService } from "./users.service.js";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(["en", "am"])
  preferredLocale?: "en" | "am";

  @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @IsOptional() @IsBoolean() analyticsConsent?: boolean;
}

class EmailVerificationRequestDto {
  @IsEmail() email!: string;
}

class EmailVerificationDto extends EmailVerificationRequestDto {
  @IsString() @Length(36, 36) challengeId!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}

class EmailRecoveryRequestDto {
  @IsEmail() email!: string;
}

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard, RateLimitGuard)
@Controller("v1/users")
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get("me")
  @RateLimit({ points: 60, durationSeconds: 60 })
  me(@Req() request: AuthenticatedRequest) {
    return this.service.profile(requireUser(request).id);
  }

  @Post("me/preferences")
  @RateLimit({ points: 30, durationSeconds: 60 })
  preferences(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    return this.service.update(requireUser(request).id, body);
  }

  @Post("me/deletion-request")
  @RateLimit({ points: 3, durationSeconds: 86_400 })
  requestDeletion(@Req() request: AuthenticatedRequest) {
    return this.service.requestDeletion(requireUser(request).id);
  }

  @Get("me/export")
  @RateLimit({ points: 3, durationSeconds: 86_400 })
  exportData(@Req() request: AuthenticatedRequest) {
    return this.service.exportData(requireUser(request).id);
  }

  @Post("me/email/verification/request")
  @RateLimit({ points: 3, durationSeconds: 900 })
  requestEmailVerification(@Req() request: AuthenticatedRequest, @Body() body: EmailVerificationRequestDto, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.requestEmailVerification(requireUser(request).id, body.email, requestId ?? null);
  }

  @Post("me/email/verification/verify")
  @RateLimit({ points: 5, durationSeconds: 900 })
  verifyEmail(@Req() request: AuthenticatedRequest, @Body() body: EmailVerificationDto) {
    return this.service.verifyEmail(requireUser(request).id, body.email, body.challengeId, body.code);
  }

  @Post("email/recovery/request")
  @RateLimit({ points: 3, durationSeconds: 900 })
  requestEmailRecovery(@Body() body: EmailRecoveryRequestDto) {
    return this.service.requestEmailRecovery(body.email);
  }
}

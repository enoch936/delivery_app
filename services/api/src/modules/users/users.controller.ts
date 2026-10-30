import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
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
  @IsOptional() @IsBoolean() acceptTerms?: boolean;
  @IsOptional() @IsBoolean() acceptPrivacy?: boolean;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(2) textScale?: number;
  @IsOptional() @IsBoolean() reduceMotion?: boolean;
  @IsOptional() @IsBoolean() highContrast?: boolean;
  @IsOptional() @IsBoolean() screenReaderHints?: boolean;
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

  @Patch("me")
  @RateLimit({ points: 30, durationSeconds: 60 })
  update(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.update(requireUser(request).id, body, requestId ?? null);
  }

  @Post("me/preferences")
  @RateLimit({ points: 30, durationSeconds: 60 })
  preferences(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.update(requireUser(request).id, body, requestId ?? null);
  }

  @Get("me/sessions")
  @RateLimit({ points: 30, durationSeconds: 60 })
  sessions(@Req() request: AuthenticatedRequest) {
    return this.service.sessions(requireUser(request).id, request.authSession?.id ?? null);
  }

  @Post("me/sessions/revoke-others")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 5, durationSeconds: 60 })
  revokeOtherSessions(@Req() request: AuthenticatedRequest, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.revokeOtherSessions(requireUser(request).id, request.authSession?.id ?? null, requestId ?? null);
  }

  @Post("me/sessions/:sessionId/revoke")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 20, durationSeconds: 60 })
  revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Headers("x-request-id") requestId: string | undefined
  ) {
    return this.service.revokeSession(requireUser(request).id, sessionId, requestId ?? null);
  }

  @Post("me/deletion-request")
  @RateLimit({ points: 3, durationSeconds: 86_400 })
  requestDeletion(@Req() request: AuthenticatedRequest, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.requestDeletion(requireUser(request).id, requestId ?? null);
  }

  @Post("me/deletion-request/cancel")
  @RateLimit({ points: 5, durationSeconds: 86_400 })
  cancelDeletion(@Req() request: AuthenticatedRequest, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.cancelDeletion(requireUser(request).id, requestId ?? null);
  }

  @Get("me/export")
  @RateLimit({ points: 3, durationSeconds: 86_400 })
  exportData(@Req() request: AuthenticatedRequest, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.exportData(requireUser(request).id, requestId ?? null);
  }

  @Post("me/email/verification/request")
  @RateLimit({ points: 3, durationSeconds: 900 })
  requestEmailVerification(@Req() request: AuthenticatedRequest, @Body() body: EmailVerificationRequestDto, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.requestEmailVerification(requireUser(request).id, body.email, requestId ?? null);
  }

  @Post("me/email/verification/verify")
  @RateLimit({ points: 5, durationSeconds: 900 })
  verifyEmail(@Req() request: AuthenticatedRequest, @Body() body: EmailVerificationDto, @Headers("x-request-id") requestId: string | undefined) {
    return this.service.verifyEmail(requireUser(request).id, body.email, body.challengeId, body.code, requestId ?? null);
  }

  @Post("email/recovery/request")
  @RateLimit({ points: 3, durationSeconds: 900 })
  requestEmailRecovery(@Body() body: EmailRecoveryRequestDto) {
    return this.service.requestEmailRecovery(body.email);
  }
}

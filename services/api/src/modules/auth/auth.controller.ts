import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";
import type { FastifyRequest } from "fastify";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit.guard.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard, type AuthenticatedRequest } from "./session.guard.js";

class RequestOtpDto {
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164!: string;
}

class VerifyOtpDto extends RequestOtpDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @Length(36, 36)
  challengeId!: string;
}

class RefreshTokenDto {
  @IsString()
  @Length(43, 128)
  refreshToken!: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  @Length(43, 128)
  refreshToken?: string;
}

@ApiTags("authentication")
@Controller("v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 5, durationSeconds: 60, keyPrefix: "otp-request" })
  @ApiAcceptedResponse({ description: "A one-time phone verification code was requested." })
  async requestOtp(@Body() body: RequestOtpDto, @Headers("x-request-id") requestId: string | undefined, @Req() request: FastifyRequest) {
    return this.authService.requestPhoneOtp({ phoneE164: body.phoneE164, requestId: requestId ?? null, ipAddress: request.ip ?? null });
  }

  @Post("otp/verify")
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 10, durationSeconds: 60, keyPrefix: "otp-verify" })
  @ApiCreatedResponse({ description: "The phone number was verified and an opaque session was created." })
  @ApiUnauthorizedResponse({ description: "The code is invalid, expired, or already used." })
  async verifyOtp(@Body() body: VerifyOtpDto, @Headers("x-request-id") requestId: string | undefined, @Req() request: FastifyRequest) {
    return this.authService.verifyPhoneOtp({ challengeId: body.challengeId, phoneE164: body.phoneE164, code: body.code, requestId: requestId ?? null, ipAddress: request.ip ?? null, userAgent: request.headers["user-agent"] ?? null });
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  async me(@Req() request: AuthenticatedRequest) {
    return { user: request.authSession?.user };
  }

  @Post("refresh")
  @ApiCreatedResponse({ description: "Rotated access and refresh tokens." })
  async refresh(@Body() body: RefreshTokenDto, @Headers("x-request-id") requestId: string | undefined, @Req() request: FastifyRequest) {
    return this.authService.refresh(body.refreshToken, { requestId: requestId ?? null, ipAddress: request.ip ?? null, userAgent: request.headers["user-agent"] ?? null });
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: "The current session and refresh token were revoked." })
  async logout(@Req() request: AuthenticatedRequest, @Headers("authorization") authorization: string, @Body() body: LogoutDto, @Headers("x-request-id") requestId: string | undefined): Promise<void> {
    await this.authService.logout(authorization.slice(7), body.refreshToken ?? null, requestId ?? null);
  }

  @Post("session/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: "The current session was revoked." })
  async revoke(@Req() request: AuthenticatedRequest, @Headers("authorization") authorization: string, @Headers("x-request-id") requestId: string | undefined): Promise<void> {
    await this.authService.revoke(authorization.slice(7), requestId ?? null);
  }
}

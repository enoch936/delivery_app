import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit.guard.js";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  displayName?: string;

  @IsOptional()
  @IsIn(["en", "am"])
  preferredLocale?: "en" | "am";
}

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard, RateLimitGuard)
@Controller("v1/users")
export class UsersController {
  @Get("me")
  @RateLimit({ points: 60, durationSeconds: 60 })
  me(@Req() request: AuthenticatedRequest) {
    return {
      user: {
        id: requireUser(request).id,
        phoneE164: requireUser(request).phoneE164,
        displayName: requireUser(request).displayName,
        accountStatus: requireUser(request).accountStatus,
        roles: requireUser(request).roles,
        locale: "en"
      },
      permissions: requireUser(request).roles
    };
  }

  @Post("me/preferences")
  @RateLimit({ points: 30, durationSeconds: 60 })
  preferences(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    return {
      updated: true,
      preferences: {
        displayName: body.displayName ?? requireUser(request).displayName,
        preferredLocale: body.preferredLocale ?? "en"
      }
    };
  }
}

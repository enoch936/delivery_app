import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { NotificationsService } from "./notifications.service.js";

class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class PreferencesDto {
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  @IsOptional() @IsBoolean() smsEnabled?: boolean;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() orderUpdates?: boolean;
  @IsOptional() @IsBoolean() promotions?: boolean;
  @IsOptional() @IsBoolean() securityAlerts?: boolean;
}

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: PaginationQuery) {
    return this.service.list(requireUser(request).id, query.limit ?? 20, query.offset ?? 0);
  }

  @Post(":notificationId/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@Req() request: AuthenticatedRequest, @Param("notificationId", ParseUUIDPipe) notificationId: string): Promise<void> {
    await this.service.markRead(requireUser(request).id, notificationId);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.service.markAllRead(requireUser(request).id);
  }

  @Get("preferences")
  getPreferences(@Req() request: AuthenticatedRequest) {
    return this.service.getPreferences(requireUser(request).id);
  }

  @Patch("preferences")
  updatePreferences(@Req() request: AuthenticatedRequest, @Body() body: PreferencesDto) {
    return this.service.updatePreferences(requireUser(request).id, body);
  }
}

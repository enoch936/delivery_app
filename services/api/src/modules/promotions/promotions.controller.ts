import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { PromotionsService } from "./promotions.service.js";

class CreatePromotionDto {
  @IsString() @Matches(/^[A-Za-z0-9-]{3,40}$/) code!: string;
  @IsString() @Length(1, 120) displayName!: string;
  @IsIn(["PERCENT", "FIXED"]) kind!: "PERCENT" | "FIXED";
  @Type(() => Number) @IsInt() @Min(1) value!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minimumOrderMinor?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maximumDiscountMinor?: number;
  @IsOptional() @IsUUID() merchantId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) usageLimit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perUserLimit?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}

class ValidatePromotionDto {
  @IsString() @Matches(/^[A-Za-z0-9-]{3,40}$/) code!: string;
  @IsUUID() merchantId!: string;
  @Type(() => Number) @IsInt() @Min(0) subtotalMinor!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}

class UpdatePromotionDto {
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) usageLimit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maximumDiscountMinor?: number;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("promotions")
@Controller("v1")
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  @Get("promotions")
  list(@Query("merchantId") merchantId: string | undefined) {
    return this.service.listActive(merchantId);
  }

  @Post("promotions/validate")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  validate(@Req() request: AuthenticatedRequest, @Body() body: ValidatePromotionDto) {
    return this.service.validate(requireUser(request).id, body.code, body.merchantId, body.subtotalMinor, body.currency);
  }

  @Get("admin/promotions")
  @ApiBearerAuth()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  adminList(@Query() query: PageQuery) {
    return this.service.adminList(query.limit ?? 50, query.offset ?? 0);
  }

  @Post("admin/promotions")
  @ApiBearerAuth()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  create(@Body() body: CreatePromotionDto) {
    return this.service.create({
      code: body.code, displayName: body.displayName, kind: body.kind, value: body.value, currency: body.currency,
      minimumOrderMinor: body.minimumOrderMinor ?? 0, maximumDiscountMinor: body.maximumDiscountMinor ?? null,
      merchantId: body.merchantId ?? null, usageLimit: body.usageLimit ?? null, perUserLimit: body.perUserLimit ?? 1,
      startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null
    });
  }

  @Patch("admin/promotions/:promotionId")
  @ApiBearerAuth()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  update(@Param("promotionId", ParseUUIDPipe) promotionId: string, @Body() body: UpdatePromotionDto) {
    return this.service.update(promotionId, body);
  }

  @Get("admin/promotions/:promotionId/redemptions")
  @ApiBearerAuth()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations", "finance")
  redemptions(@Param("promotionId", ParseUUIDPipe) promotionId: string, @Query() query: PageQuery) {
    return this.service.redemptions(promotionId, query.limit ?? 50, query.offset ?? 0);
  }
}

import { Body, Controller, Get, Param, Patch, Put, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { ConfigService } from "./config.service.js";

class FeatureFlagDto {
  @IsBoolean() enabled!: boolean;
}

class PricingRuleDto {
  @IsOptional() @IsString() serviceCategorySlug?: string | null;
  @Type(() => Number) @IsInt() @Min(0) baseDeliveryFeeMinor!: number;
  @Type(() => Number) @IsInt() @Min(0) perKmFeeMinor!: number;
  @Type(() => Number) @IsInt() @Min(0) minimumDeliveryFeeMinor!: number;
  @Type(() => Number) @IsInt() @Min(0) maximumDeliveryFeeMinor!: number;
  @Type(() => Number) @IsInt() @Min(0) serviceFeeMinor!: number;
  @Type(() => Number) @IsInt() @Min(0) nightSurchargeMinor!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) commissionBps!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}

@ApiTags("config")
@Controller("v1")
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get("config")
  async publicConfig() {
    const svc = this.configService as any;
    if (svc && typeof svc.publicConfig === "function") {
      return await svc.publicConfig();
    }
    throw new Error("Config service not available");
  }

  @Get("admin/feature-flags")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  flags() {
    return this.configService.featureFlags();
  }

  @Patch("admin/feature-flags/:key")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  updateFlag(@Req() request: AuthenticatedRequest, @Param("key") key: string, @Body() body: FeatureFlagDto) {
    return this.configService.updateFeatureFlag(key, body.enabled, requireUser(request).id);
  }

  @Put("admin/pricing-rules")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "finance", "operations")
  updatePricing(@Body() body: PricingRuleDto) {
    return this.configService.updatePricing({ ...body, serviceCategorySlug: body.serviceCategorySlug ?? null });
  }
}

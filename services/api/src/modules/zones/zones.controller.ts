import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, IsUUID, Matches, Length } from "class-validator";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ZonesService } from "./zones.service.js";

class CreateZoneDto {
  @IsUUID() cityId!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @Length(1, 120) displayName!: string;
  @IsObject() boundary!: Record<string, unknown>;
  @IsOptional() @IsObject() operatingHours?: Record<string, unknown>;
}

class UpdateZoneDto {
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
  @IsOptional() @IsObject() boundary?: Record<string, unknown>;
  @IsOptional() @IsObject() operatingHours?: Record<string, unknown>;
}

class ZoneActiveDto {
  @IsBoolean() isActive!: boolean;
}

@ApiTags("zones")
@Controller("v1")
export class ZonesController {
  constructor(private readonly service: ZonesService) {}

  @Get("zones")
  list(@Query("citySlug") citySlug: string | undefined) {
    return this.service.list(citySlug);
  }

  @Get("zones/check")
  check(@Query("latitude") latitude: string, @Query("longitude") longitude: string) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { serviceable: false, zone: null, error: "Invalid coordinates" };
    }
    return this.service.check(lat, lng);
  }

  @Get("admin/zones")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  adminList() {
    return this.service.adminList();
  }

  @Post("admin/zones")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  create(@Body() body: CreateZoneDto) {
    return this.service.create({ cityId: body.cityId, slug: body.slug, displayName: body.displayName, boundary: body.boundary, operatingHours: body.operatingHours ?? {} });
  }

  @Patch("admin/zones/:zoneId")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  update(@Param("zoneId", ParseUUIDPipe) zoneId: string, @Body() body: UpdateZoneDto) {
    return this.service.update(zoneId, body);
  }

  @Patch("admin/zones/:zoneId/active")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin", "operations")
  setActive(@Param("zoneId", ParseUUIDPipe) zoneId: string, @Body() body: ZoneActiveDto) {
    return this.service.setActive(zoneId, body.isActive);
  }
}

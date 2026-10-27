import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { CourierService } from "./courier.service.js";

class RegisterDto {
  @IsString() @Length(2, 120) fullName!: string;
  @IsIn(["walking", "bicycle", "motorcycle", "car", "van"]) vehicleType!: string;
  @IsOptional() @IsString() @Length(1, 40) vehiclePlate?: string;
  @IsOptional() @IsUUID() serviceZoneId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacityUnits?: number;
}

class UpdateCourierDto {
  @IsOptional() @IsString() @Length(2, 120) fullName?: string;
  @IsOptional() @IsIn(["walking", "bicycle", "motorcycle", "car", "van"]) vehicleType?: string;
  @IsOptional() @IsString() @Length(1, 40) vehiclePlate?: string;
  @IsOptional() @IsUUID() serviceZoneId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacityUnits?: number;
}

class DocumentDto {
  @IsIn(["national_id", "driving_license", "vehicle_registration", "insurance", "profile_photo"]) documentType!: string;
  @IsString() @Length(3, 500) storageKey!: string;
}

class AvailabilityDto {
  @IsBoolean() isOnline!: boolean;
  @IsOptional() @IsBoolean() acceptingOffers?: boolean;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
}

class LocationDto {
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() accuracyMeters?: number;
  @IsOptional() @IsNumber() headingDegrees?: number;
  @IsOptional() @IsNumber() speedMps?: number;
}

class TransitionDto {
  @IsOptional() @IsString() @Length(4, 12) proofCode?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("courier")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller("v1/courier")
export class CourierController {
  constructor(private readonly service: CourierService) {}

  @Get("me")
  @Roles("courier", "admin")
  me(@Req() request: AuthenticatedRequest) {
    return this.service.profile(requireUser(request).id);
  }

  @Post("register")
  register(@Req() request: AuthenticatedRequest, @Body() body: RegisterDto) {
    return this.service.register(requireUser(request).id, body);
  }

  @Patch("me")
  @Roles("courier")
  update(@Req() request: AuthenticatedRequest, @Body() body: UpdateCourierDto) {
    return this.service.updateProfile(requireUser(request).id, body);
  }

  @Post("documents")
  @Roles("courier")
  document(@Req() request: AuthenticatedRequest, @Body() body: DocumentDto) {
    return this.service.addDocument(requireUser(request).id, body);
  }

  @Put("availability")
  @Roles("courier")
  availability(@Req() request: AuthenticatedRequest, @Body() body: AvailabilityDto) {
    return this.service.setAvailability(requireUser(request).id, body);
  }

  @Post("location")
  @Roles("courier")
  location(@Req() request: AuthenticatedRequest, @Body() body: LocationDto) {
    return this.service.recordLocation(requireUser(request).id, body);
  }

  @Get("deliveries/active")
  @Roles("courier")
  active(@Req() request: AuthenticatedRequest) {
    return this.service.activeDelivery(requireUser(request).id);
  }

  @Get("deliveries")
  @Roles("courier")
  deliveries(@Req() request: AuthenticatedRequest, @Query("scope") scope: "active" | "history" | undefined, @Query() query: PageQuery) {
    return this.service.deliveries(requireUser(request).id, scope === "active" ? "active" : "history", query.limit ?? 30, query.offset ?? 0);
  }

  @Post("deliveries/:orderId/:action")
  @Roles("courier")
  transition(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Param("action") action: string, @Body() body: TransitionDto) {
    if (!["arrived_pickup", "picked_up", "in_transit", "delivered", "failed"].includes(action)) throw new BadRequestException("Unsupported delivery action.");
    return this.service.transition(requireUser(request).id, orderId, action as "arrived_pickup" | "picked_up" | "in_transit" | "delivered" | "failed", body, requestId(request));
  }

  @Get("earnings")
  @Roles("courier")
  earnings(@Req() request: AuthenticatedRequest) {
    return this.service.earnings(requireUser(request).id);
  }
}

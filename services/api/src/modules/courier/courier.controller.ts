import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { FAILURE_REASONS, isCourierAction, type CourierAction, type FailureReasonCode } from "@delivery-app/domain";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { CourierService } from "./courier.service.js";

class RegisterDto {
  @IsString() @Length(2, 120) fullName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsUUID() cityId?: string;
  @IsOptional() @IsString() @Length(2, 80) serviceCategorySlug?: string;
  @IsIn(["walking", "bicycle", "motorcycle", "car", "van"]) vehicleType!: string;
  @IsOptional() @IsString() @Length(1, 80) vehicleModel?: string;
  @IsOptional() @IsString() @Length(1, 40) vehiclePlate?: string;
  @IsOptional() @IsString() @Length(1, 80) licenseNumber?: string;
  @IsOptional() @IsUUID() serviceZoneId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacityUnits?: number;
  @IsOptional() @IsObject() availabilityPreferences?: Record<string, unknown>;
}

class UpdateCourierDto {
  @IsOptional() @IsString() @Length(2, 120) fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsUUID() cityId?: string;
  @IsOptional() @IsString() @Length(2, 80) serviceCategorySlug?: string;
  @IsOptional() @IsIn(["walking", "bicycle", "motorcycle", "car", "van"]) vehicleType?: string;
  @IsOptional() @IsString() @Length(1, 80) vehicleModel?: string;
  @IsOptional() @IsString() @Length(1, 40) vehiclePlate?: string;
  @IsOptional() @IsString() @Length(1, 80) licenseNumber?: string;
  @IsOptional() @IsUUID() serviceZoneId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacityUnits?: number;
  @IsOptional() @IsObject() availabilityPreferences?: Record<string, unknown>;
}

class DocumentDto {
  @IsIn(["national_id", "driving_license", "vehicle_registration", "insurance", "profile_photo"]) documentType!: string;
  @IsString() @Length(3, 500) storageKey!: string;
}

class UploadDocumentDto {
  @IsIn(["national_id", "driving_license", "vehicle_registration", "insurance", "profile_photo"]) documentType!: string;
  @IsString() @Length(1, 160) fileName!: string;
  @IsString() @IsIn(["image/jpeg", "image/png", "image/webp", "application/pdf"]) contentType!: string;
  @IsString() @Length(16, 12_000_000) dataBase64!: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsUUID() replacesDocumentId?: string;
}

class VerificationRequirementsQuery {
  @IsOptional() @IsUUID() cityId?: string;
  @IsOptional() @IsString() @Length(2, 80) serviceCategorySlug?: string;
  @IsOptional() @IsIn(["walking", "bicycle", "motorcycle", "car", "van"]) vehicleType?: string;
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

class EarningsDisputeDto {
  @IsString() @Length(3, 160) subject!: string;
  @IsString() @Length(1, 4000) message!: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() payoutId?: string;
}

class TransitionDto {
  @IsOptional() @IsString() @Length(4, 256) proofCode?: string;
  @IsOptional() @IsString() @Length(3, 700_000) proofStorageKey?: string;
  @IsOptional() @IsString() @Length(2, 120) recipientName?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsIn(FAILURE_REASONS.map((reason) => reason.code)) failureReason?: FailureReasonCode;
  @IsOptional() @IsBoolean() returnRequired?: boolean;
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

  @Get("verification/requirements")
  @Roles("courier", "admin")
  requirements(@Req() request: AuthenticatedRequest, @Query() query: VerificationRequirementsQuery) {
    return this.service.requirements(requireUser(request).id, query.cityId, query.serviceCategorySlug, query.vehicleType);
  }

  @Post("documents")
  @Roles("courier")
  document(@Req() request: AuthenticatedRequest, @Body() body: DocumentDto) {
    return this.service.addDocument(requireUser(request).id, body);
  }

  @Post("documents/upload")
  @Roles("courier")
  uploadDocument(@Req() request: AuthenticatedRequest, @Body() body: UploadDocumentDto) {
    return this.service.uploadDocument(requireUser(request).id, body);
  }

  @Get("documents/:documentId/file")
  @Roles("courier", "admin")
  documentFile(@Req() request: AuthenticatedRequest, @Param("documentId", ParseUUIDPipe) documentId: string) {
    return this.service.documentFile(requireUser(request).id, documentId, requireUser(request).roles);
  }

  @Post("verification/submit")
  @Roles("courier")
  submitVerification(@Req() request: AuthenticatedRequest) {
    return this.service.submitVerification(requireUser(request).id);
  }

  @Put("availability")
  @Roles("courier")
  availability(@Req() request: AuthenticatedRequest, @Body() body: AvailabilityDto) {
    return this.service.setAvailability(requireUser(request).id, body);
  }

  @Post("location")
  @Roles("courier")
  location(@Req() request: AuthenticatedRequest, @Body() body: LocationDto, @Headers("idempotency-key") idempotencyKey: string | undefined) {
    return this.service.recordLocation(requireUser(request).id, body, idempotencyKey);
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

  @Get("returns")
  @Roles("courier")
  returns(@Req() request: AuthenticatedRequest) {
    return this.service.pendingReturns(requireUser(request).id);
  }

  @Get("deliveries/:orderId")
  @Roles("courier")
  delivery(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.delivery(requireUser(request).id, orderId);
  }

  @Post("deliveries/:orderId/:action")
  @Roles("courier")
  transition(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Param("action") action: string, @Body() body: TransitionDto, @Headers("idempotency-key") idempotencyKey: string | undefined) {
    if (!isCourierAction(action)) throw new BadRequestException("Unsupported delivery action.");
    return this.service.transition(requireUser(request).id, orderId, action as CourierAction, body, requestId(request), idempotencyKey);
  }

  @Get("earnings")
  @Roles("courier")
  earnings(@Req() request: AuthenticatedRequest) {
    return this.service.earnings(requireUser(request).id);
  }

  @Get("earnings/disputes")
  @Roles("courier")
  earningsDisputes(@Req() request: AuthenticatedRequest) {
    return this.service.earningsDisputes(requireUser(request).id);
  }

  @Post("earnings/disputes")
  @Roles("courier")
  createEarningsDispute(@Req() request: AuthenticatedRequest, @Body() body: EarningsDisputeDto) {
    return this.service.createEarningsDispute(requireUser(request).id, {
      subject: body.subject,
      message: body.message,
      orderId: body.orderId ?? null,
      payoutId: body.payoutId ?? null,
    });
  }
}

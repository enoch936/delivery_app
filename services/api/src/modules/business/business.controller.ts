import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { BusinessService } from "./business.service.js";

class RegisterBusinessDto {
  @IsString() @Length(2, 160) name!: string;
  @IsOptional() @IsEmail() billingEmail?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) billingPhone?: string;
  @IsOptional() @IsString() @Length(0, 60) taxIdentifier?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) monthlySpendLimitMinor?: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
}

class AddMemberDto {
  @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phoneE164!: string;
  @IsIn(["admin", "member", "driver"]) role!: "admin" | "member" | "driver";
}

class AddLocationDto {
  @IsString() @Length(1, 80) label!: string;
  @IsString() @Length(3, 300) addressLine!: string;
  @IsOptional() @IsString() @Length(0, 120) contactName?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) contactPhone?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
}

class AttachOrderDto {
  @IsUUID() orderId!: string;
  @IsOptional() @IsString() @Length(0, 80) costCenter?: string;
  @IsOptional() @IsString() @Length(0, 80) referenceCode?: string;
}

class BulkAttachDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AttachOrderDto) items!: AttachOrderDto[];
}

class CsvImportDto {
  @IsString() @Length(1, 1_000_000) csv!: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

class CostCenterDto {
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/) code!: string;
  @IsString() @Length(2, 120) displayName!: string;
}

class ScheduleDeliveryDto {
  @IsIn(["daily", "weekly", "monthly"]) frequency!: "daily" | "weekly" | "monthly";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) intervalCount?: number;
  @IsDateString() nextRunAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
}

class StopDto {
  @IsIn(["pickup", "dropoff", "waypoint"]) stopType!: "pickup" | "dropoff" | "waypoint";
  @Type(() => Number) @IsInt() @Min(1) sequenceNumber!: number;
  @IsOptional() @IsString() @Length(0, 80) label?: string;
  @IsString() @Length(3, 300) addressLine!: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @Length(0, 120) contactName?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) contactPhone?: string;
}

class MultiStopDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => StopDto) stops!: StopDto[];
}

class BusinessReportQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

class FleetVehicleDto {
  @IsString() @Length(2, 100) label!: string;
  @IsIn(["motorcycle", "car", "van", "bicycle"]) vehicleType!: "motorcycle" | "car" | "van" | "bicycle";
  @IsOptional() @IsString() @Length(0, 100) makeModel?: string;
  @IsString() @Length(2, 32) plateNumber!: string;
  @IsOptional() @IsDateString() registrationExpiresOn?: string | null;
  @IsOptional() @IsDateString() insuranceExpiresOn?: string | null;
}

class UpdateFleetVehicleDto {
  @IsOptional() @IsString() @Length(2, 100) label?: string;
  @IsOptional() @IsIn(["motorcycle", "car", "van", "bicycle"]) vehicleType?: "motorcycle" | "car" | "van" | "bicycle";
  @IsOptional() @IsString() @Length(0, 100) makeModel?: string;
  @IsOptional() @IsString() @Length(2, 32) plateNumber?: string;
  @IsOptional() @IsDateString() registrationExpiresOn?: string | null;
  @IsOptional() @IsDateString() insuranceExpiresOn?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class AssignFleetDeliveryDto {
  @IsUUID() orderId!: string;
  @IsUUID() driverUserId!: string;
  @IsUUID() vehicleId!: string;
}

class ReviewBusinessDto {
  @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
  @IsOptional() @IsString() @Length(0, 1000) verificationNotes?: string;
  @IsOptional() @IsString() @Length(0, 300) rejectionReason?: string;
}

class AdminSpendLimitsDto {
  @IsOptional() @IsInt() @Min(0) spendingLimitMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) monthlySpendingLimitMinor?: number | null;
}

class AdminBusinessMemberRoleDto {
  @IsIn(["admin", "member", "driver"]) role!: "admin" | "member" | "driver";
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @IsString() status?: string;
}

@ApiTags("business")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller("v1")
export class BusinessController {
  constructor(private readonly service: BusinessService) {}

  @Post("business/accounts")
  register(@Req() request: AuthenticatedRequest, @Body() body: RegisterBusinessDto) {
    return this.service.register(requireUser(request).id, {
      name: body.name, billingEmail: body.billingEmail ?? null, billingPhone: body.billingPhone ?? null,
      taxIdentifier: body.taxIdentifier ?? null, monthlySpendLimitMinor: body.monthlySpendLimitMinor ?? null, currency: body.currency ?? "ETB"
    });
  }

  @Get("business/accounts")
  mine(@Req() request: AuthenticatedRequest) {
    return this.service.mine(requireUser(request).id);
  }

  @Get("business/accounts/:accountId")
  detail(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.service.detail(requireUser(request).id, accountId);
  }

  @Post("business/accounts/:accountId/members")
  addMember(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: AddMemberDto) {
    return this.service.addMember(requireUser(request).id, accountId, body.phoneE164, body.role);
  }

  @Delete("business/accounts/:accountId/members/:memberId")
  removeMember(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("memberId", ParseUUIDPipe) memberId: string) {
    return this.service.removeMember(requireUser(request).id, accountId, memberId);
  }

  @Post("business/accounts/:accountId/locations")
  addLocation(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: AddLocationDto) {
    return this.service.addLocation(requireUser(request).id, accountId, {
      label: body.label, addressLine: body.addressLine, contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null, latitude: body.latitude ?? null, longitude: body.longitude ?? null
    });
  }

  @Get("business/accounts/:accountId/cost-centers")
  costCenters(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.service.costCenters(requireUser(request).id, accountId);
  }

  @Post("business/accounts/:accountId/cost-centers")
  createCostCenter(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: CostCenterDto) {
    return this.service.createCostCenter(requireUser(request).id, accountId, body);
  }

  @Post("business/accounts/:accountId/orders/:orderId")
  attachOrder(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: AttachOrderDto) {
    return this.service.attachOrder(requireUser(request).id, accountId, orderId, { costCenter: body.costCenter ?? null, referenceCode: body.referenceCode ?? null });
  }

  @Post("business/accounts/:accountId/orders/bulk")
  bulkAttach(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: BulkAttachDto) {
    return this.service.bulkAttach(requireUser(request).id, accountId, body.items);
  }

  @Post("business/accounts/:accountId/orders/import")
  importOrders(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: CsvImportDto) {
    return this.service.importOrders(requireUser(request).id, accountId, body.csv, body.dryRun ?? true);
  }

  @Post("business/accounts/:accountId/orders/:orderId/schedule")
  schedule(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: ScheduleDeliveryDto) {
    return this.service.schedule(requireUser(request).id, accountId, orderId, {
      frequency: body.frequency, intervalCount: body.intervalCount ?? 1,
      nextRunAt: body.nextRunAt, endAt: body.endAt ?? null
    });
  }

  @Get("business/accounts/:accountId/schedules")
  schedules(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.service.schedules(requireUser(request).id, accountId);
  }

  @Put("business/accounts/:accountId/orders/:orderId/stops")
  multiStop(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: MultiStopDto) {
    return this.service.multiStop(requireUser(request).id, accountId, orderId, body.stops);
  }

  @Post("business/accounts/:accountId/orders/:orderId/invoice")
  createInvoice(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.createInvoice(requireUser(request).id, accountId, orderId);
  }

  @Get("business/accounts/:accountId/invoices")
  invoices(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Query() query: PageQuery) {
    return this.service.invoices(requireUser(request).id, accountId, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("business/accounts/:accountId/report")
  report(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Query() query: BusinessReportQuery) {
    return this.service.report(requireUser(request).id, accountId, query.days ?? 30);
  }

  @Get("business/accounts/:accountId/fleet")
  fleet(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.service.fleet(requireUser(request).id, accountId);
  }

  @Post("business/accounts/:accountId/fleet/vehicles")
  createFleetVehicle(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: FleetVehicleDto) {
    return this.service.createFleetVehicle(requireUser(request).id, accountId, body);
  }

  @Patch("business/accounts/:accountId/fleet/vehicles/:vehicleId")
  updateFleetVehicle(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("vehicleId", ParseUUIDPipe) vehicleId: string, @Body() body: UpdateFleetVehicleDto) {
    return this.service.updateFleetVehicle(requireUser(request).id, accountId, vehicleId, body);
  }

  @Post("business/accounts/:accountId/fleet/assignments")
  assignFleetDelivery(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: AssignFleetDeliveryDto) {
    return this.service.assignFleetDelivery(requireUser(request).id, accountId, body);
  }

  @Get("admin/business-accounts")
  @Roles("admin", "operations", "finance")
  adminList(@Query() query: PageQuery) {
    return this.service.adminList(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("admin/business-accounts/:accountId")
  @Roles("admin", "operations")
  adminDetail(@Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.service.adminDetail(accountId);
  }

  @Patch("admin/business-accounts/:accountId/spending-limits")
  @Roles("admin", "finance")
  updateSpendingLimits(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: AdminSpendLimitsDto) {
    return this.service.updateAdminSpendLimits(accountId, requireUser(request).id, body);
  }

  @Patch("admin/business-accounts/:accountId/members/:memberId/role")
  @Roles("admin", "operations")
  updateBusinessMemberRole(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("memberId", ParseUUIDPipe) memberId: string, @Body() body: AdminBusinessMemberRoleDto) {
    return this.service.updateAdminMemberRole(accountId, memberId, requireUser(request).id, body.role);
  }

  @Patch("admin/business-accounts/:accountId/review")
  @Roles("admin", "operations")
  review(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: ReviewBusinessDto) {
    return this.service.review(accountId, requireUser(request).id, body.decision, {
      verificationNotes: body.verificationNotes,
      rejectionReason: body.rejectionReason
    });
  }
}

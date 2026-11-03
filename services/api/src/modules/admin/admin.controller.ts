import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { AdminService } from "./admin.service.js";

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @IsString() status?: string;
}

class OverviewQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() citySlug?: string;
  @IsOptional() @IsString() zoneSlug?: string;
  @IsOptional() @IsUUID() merchantId?: string;
  @IsOptional() @IsString() categorySlug?: string;
}

class CreateOperatorDto {
  @IsString() @Length(10, 20) phoneE164!: string;
  @IsOptional() @IsString() @Length(2, 80) displayName?: string;
  @IsArray() @ArrayUnique() @IsIn(["admin", "support", "operations", "finance", "business_admin"], { each: true }) roles!: string[];
}

class ReasonDto {
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

class DocumentReviewDto {
  @IsIn(["approved", "rejected"]) status!: "approved" | "rejected";
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

class UserQuery extends PageQuery {
  @IsOptional() @IsString() search?: string;
}

class RolesDto {
  @IsArray() @ArrayUnique() @IsIn(["customer", "courier", "merchant_staff", "admin", "support", "operations", "finance", "business_admin"], { each: true }) roles!: string[];
}

class UserStatusDto {
  @IsIn(["active", "suspended", "disabled", "pending", "deletion_requested"]) accountStatus!: string;
}

class MerchantStatusDto {
  @IsIn(["active", "suspended", "closed"]) status!: "active" | "suspended" | "closed";
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

class CourierDecisionDto {
  @IsIn(["approve", "reject", "suspend", "reactivate"]) decision!: "approve" | "reject" | "suspend" | "reactivate";
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin", "operations", "support", "finance")
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get("dashboard")
  @Roles("admin", "operations", "finance")
  dashboard() {
    return this.service.dashboard();
  }

  @Get("operator-overview")
  @Roles("admin", "operations", "finance")
  operatorOverview(@Query() query: OverviewQuery) {
    return this.service.operatorOverview(query);
  }

  @Get("operators")
  @Roles("admin")
  operators(@Query() query: PageQuery) {
    return this.service.operators(query.limit ?? 50, query.offset ?? 0);
  }

  @Post("operators")
  @Roles("admin")
  createOperator(@Req() request: AuthenticatedRequest, @Body() body: CreateOperatorDto) {
    return this.service.createOperator(requireUser(request).id, { phoneE164: body.phoneE164, ...(body.displayName !== undefined && { displayName: body.displayName }), roles: body.roles }, requestId(request));
  }

  @Post("operators/:userId/sessions/revoke-all")
  @Roles("admin")
  revokeOperatorSessions(@Req() request: AuthenticatedRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.service.revokeOperatorSessions(requireUser(request).id, userId, requestId(request));
  }

  @Get("merchants")
  @Roles("admin", "operations", "support")
  merchants(@Query() query: PageQuery) {
    return this.service.merchants(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("merchants/:merchantId/documents")
  @Roles("admin", "operations", "support", "finance")
  merchantDocuments(@Param("merchantId", ParseUUIDPipe) merchantId: string) {
    return this.service.merchantDocuments(merchantId);
  }

  @Patch("merchant-documents/:documentId/review")
  @Roles("admin", "operations")
  reviewMerchantDocument(@Req() request: AuthenticatedRequest, @Param("documentId", ParseUUIDPipe) documentId: string, @Body() body: DocumentReviewDto) {
    return this.service.reviewMerchantDocument(requireUser(request).id, documentId, body.status, body.notes ?? null, requestId(request));
  }

  @Patch("merchants/:merchantId/status")
  @Roles("admin", "operations")
  setMerchantStatus(@Req() request: AuthenticatedRequest, @Param("merchantId", ParseUUIDPipe) merchantId: string, @Body() body: MerchantStatusDto) {
    return this.service.setMerchantStatus(requireUser(request).id, merchantId, body.status, body.reason ?? null, requestId(request));
  }

  @Get("couriers")
  @Roles("admin", "operations", "support")
  couriers(@Query() query: PageQuery) {
    return this.service.couriers(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Post("couriers/:courierUserId/review")
  @Roles("admin", "operations")
  reviewCourier(@Req() request: AuthenticatedRequest, @Param("courierUserId", ParseUUIDPipe) courierUserId: string, @Body() body: CourierDecisionDto) {
    return this.service.reviewCourier(requireUser(request).id, courierUserId, body.decision, body.reason ?? null, requestId(request));
  }

  @Get("couriers/:courierUserId/documents")
  @Roles("admin", "operations", "support")
  courierDocuments(@Param("courierUserId", ParseUUIDPipe) courierUserId: string) {
    return this.service.courierDocuments(courierUserId);
  }

  @Get("courier-documents/:documentId/file")
  @Roles("admin", "operations", "support")
  courierDocumentFile(@Req() request: AuthenticatedRequest, @Param("documentId", ParseUUIDPipe) documentId: string) {
    return this.service.courierDocumentFile(requireUser(request).id, documentId, requireUser(request).roles);
  }

  @Get("users")
  @Roles("admin", "operations", "support")
  users(@Query() query: UserQuery) {
    return this.service.users(query.search, query.limit ?? 50, query.offset ?? 0);
  }

  @Patch("users/:userId/roles")
  @Roles("admin")
  setRoles(@Req() request: AuthenticatedRequest, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: RolesDto) {
    return this.service.setUserRoles(requireUser(request).id, userId, body.roles, requestId(request));
  }

  @Patch("users/:userId/status")
  @Roles("admin", "operations")
  setStatus(@Req() request: AuthenticatedRequest, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: UserStatusDto) {
    return this.service.setUserStatus(requireUser(request).id, userId, body.accountStatus, requestId(request));
  }

  @Get("audit-log")
  @Roles("admin")
  audit(@Query() query: PageQuery, @Query("entityType") entityType: string | undefined) {
    return this.service.auditLog(query.limit ?? 50, query.offset ?? 0, entityType);
  }

  @Get("orders")
  @Roles("admin", "operations", "support")
  orders(@Query() query: PageQuery) {
    return this.service.orders(query.status, query.limit ?? 50, query.offset ?? 0);
  }
}

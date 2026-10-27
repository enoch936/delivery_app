import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
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
}

class CourierDecisionDto {
  @IsIn(["approve", "reject", "suspend"]) decision!: "approve" | "reject" | "suspend";
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
  dashboard() {
    return this.service.dashboard();
  }

  @Get("merchants")
  merchants(@Query() query: PageQuery) {
    return this.service.merchants(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Patch("merchants/:merchantId/status")
  @Roles("admin", "operations")
  setMerchantStatus(@Req() request: AuthenticatedRequest, @Param("merchantId", ParseUUIDPipe) merchantId: string, @Body() body: MerchantStatusDto) {
    return this.service.setMerchantStatus(requireUser(request).id, merchantId, body.status, requestId(request));
  }

  @Get("couriers")
  couriers(@Query() query: PageQuery) {
    return this.service.couriers(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Post("couriers/:courierUserId/review")
  @Roles("admin", "operations")
  reviewCourier(@Req() request: AuthenticatedRequest, @Param("courierUserId", ParseUUIDPipe) courierUserId: string, @Body() body: CourierDecisionDto) {
    return this.service.reviewCourier(requireUser(request).id, courierUserId, body.decision, body.reason ?? null, requestId(request));
  }

  @Get("couriers/:courierUserId/documents")
  courierDocuments(@Param("courierUserId", ParseUUIDPipe) courierUserId: string) {
    return this.service.courierDocuments(courierUserId);
  }

  @Patch("courier-documents/:documentId/review")
  @Roles("admin", "operations")
  reviewDocument(@Req() request: AuthenticatedRequest, @Param("documentId", ParseUUIDPipe) documentId: string, @Body() body: DocumentReviewDto) {
    return this.service.reviewDocument(requireUser(request).id, documentId, body.status, body.notes ?? null, requestId(request));
  }

  @Get("users")
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
  orders(@Query() query: PageQuery) {
    return this.service.orders(query.status, query.limit ?? 50, query.offset ?? 0);
  }
}

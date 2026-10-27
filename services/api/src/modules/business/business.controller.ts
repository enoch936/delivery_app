import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from "class-validator";
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
  @IsOptional() @IsString() @Length(0, 80) costCenter?: string;
  @IsOptional() @IsString() @Length(0, 80) referenceCode?: string;
}

class ReviewBusinessDto {
  @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
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

  @Post("business/accounts/:accountId/locations")
  addLocation(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: AddLocationDto) {
    return this.service.addLocation(requireUser(request).id, accountId, {
      label: body.label, addressLine: body.addressLine, contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null, latitude: body.latitude ?? null, longitude: body.longitude ?? null
    });
  }

  @Post("business/accounts/:accountId/orders/:orderId")
  attachOrder(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() body: AttachOrderDto) {
    return this.service.attachOrder(requireUser(request).id, accountId, orderId, { costCenter: body.costCenter ?? null, referenceCode: body.referenceCode ?? null });
  }

  @Get("business/accounts/:accountId/orders")
  orders(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Query() query: PageQuery) {
    return this.service.orders(requireUser(request).id, accountId, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("admin/business-accounts")
  @Roles("admin", "operations", "finance")
  adminList(@Query() query: PageQuery) {
    return this.service.adminList(query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Patch("admin/business-accounts/:accountId/review")
  @Roles("admin", "operations")
  review(@Req() request: AuthenticatedRequest, @Param("accountId", ParseUUIDPipe) accountId: string, @Body() body: ReviewBusinessDto) {
    return this.service.review(accountId, requireUser(request).id, body.decision);
  }
}

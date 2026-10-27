import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { MerchantService } from "./merchant.service.js";

class UpdateMerchantDto {
  @IsOptional() @IsString() @Length(2, 120) displayName?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(1, 500) logoUrl?: string;
}

class LocationActiveDto {
  @IsBoolean() active!: boolean;
}

class OrderListQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class RejectOrderDto {
  @IsOptional() @IsString() @Length(0, 300) reason?: string;
}

class CategoryDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @Length(1, 80) displayName!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

class CreateProductDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @Length(0, 80) sku?: string;
  @IsString() @Length(1, 160) displayName!: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(1, 500) imageUrl?: string;
  @Type(() => Number) @IsInt() @Min(0) basePriceMinor!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) initialStock?: number;
}

class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 160) displayName?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(1, 500) imageUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) basePriceMinor?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsUUID() categoryId?: string;
}

class InventoryDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(100000) quantity!: number;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("merchant")
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller("v1/merchant")
export class MerchantController {
  constructor(private readonly service: MerchantService) {}

  @Get("me")
  @Roles("merchant_staff", "admin")
  me(@Req() request: AuthenticatedRequest) {
    return this.service.me(requireUser(request).id);
  }

  @Patch("me")
  @Roles("merchant_staff")
  update(@Req() request: AuthenticatedRequest, @Body() body: UpdateMerchantDto) {
    return this.service.updateMerchant(requireUser(request).id, body);
  }

  @Patch("locations/:locationId")
  @Roles("merchant_staff")
  setLocation(@Req() request: AuthenticatedRequest, @Param("locationId", ParseUUIDPipe) locationId: string, @Body() body: LocationActiveDto) {
    return this.service.setLocationActive(requireUser(request).id, locationId, body.active);
  }

  @Get("orders")
  @Roles("merchant_staff", "admin")
  orders(@Req() request: AuthenticatedRequest, @Query() query: OrderListQuery) {
    return this.service.listOrders(requireUser(request).id, query.status, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("orders/:orderId")
  @Roles("merchant_staff", "admin")
  order(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.service.orderDetail(requireUser(request).id, orderId);
  }

  @Post("orders/:orderId/:action")
  @Roles("merchant_staff", "admin")
  transition(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string, @Param("action") action: string, @Body() body: RejectOrderDto) {
    const user = requireUser(request);
    if (!["accept", "prepare", "ready", "reject"].includes(action)) throw new BadRequestException("Unsupported action.");
    return this.service.transition(user.id, orderId, action as "accept" | "prepare" | "ready" | "reject", body.reason, requestId(request));
  }

  @Get("menu")
  @Roles("merchant_staff", "admin")
  menu(@Req() request: AuthenticatedRequest) {
    return this.service.menu(requireUser(request).id);
  }

  @Post("categories")
  @Roles("merchant_staff")
  createCategory(@Req() request: AuthenticatedRequest, @Body() body: CategoryDto) {
    return this.service.createCategory(requireUser(request).id, { slug: body.slug, displayName: body.displayName, sortOrder: body.sortOrder ?? 0 });
  }

  @Post("products")
  @Roles("merchant_staff")
  createProduct(@Req() request: AuthenticatedRequest, @Body() body: CreateProductDto) {
    return this.service.createProduct(requireUser(request).id, body);
  }

  @Patch("products/:productId")
  @Roles("merchant_staff")
  updateProduct(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string, @Body() body: UpdateProductDto) {
    return this.service.updateProduct(requireUser(request).id, productId, body);
  }

  @Patch("products/:productId/inventory")
  @Roles("merchant_staff")
  inventory(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string, @Body() body: InventoryDto) {
    return this.service.setInventory(requireUser(request).id, productId, body.quantity);
  }

  @Get("settlements")
  @Roles("merchant_staff", "admin")
  settlements(@Req() request: AuthenticatedRequest, @Query() query: PageQuery) {
    return this.service.settlements(requireUser(request).id, query.limit ?? 50, query.offset ?? 0);
  }
}


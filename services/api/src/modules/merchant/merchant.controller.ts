import { BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ArrayMinSize, ArrayUnique, ValidateNested } from "class-validator";
import { requireUser, requestId } from "../../common/auth-context.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { MerchantService } from "./merchant.service.js";

class UpdateMerchantDto {
  @IsOptional() @IsString() @Length(2, 120) displayName?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(1, 500) logoUrl?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) commissionBps?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) deliveryRadiusKm?: number;
  @IsOptional() @IsString() @Length(0, 1000) cancellationPolicy?: string;
  @IsOptional() @IsString() @Length(0, 1000) refundPolicy?: string;
}

class LocationActiveDto {
  @IsBoolean() active!: boolean;
}

class LocationHoursDto {
  @IsObject() openingHours!: Record<string, unknown>;
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

class CategoryUpdateDto {
  @IsOptional() @IsString() @Length(1, 80) displayName?: string;
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
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) prepMinutes?: number;
}

class BulkImportItemDto {
  @IsString() @Length(1, 160) displayName!: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @Length(0, 60) sku?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(1, 500) imageUrl?: string;
  @IsInt() @Min(0) basePriceMinor!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) initialStock?: number;
  @IsString() @Length(3, 3) currency!: string;
}

class BulkImportDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BulkImportItemDto) items!: BulkImportItemDto[];
}

class BulkArchiveDto {
  @IsArray() @ArrayUnique() @ArrayMinSize(1) @IsUUID("4", { each: true }) ids!: string[];
}

class InventoryDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(100000) quantity!: number;
}

class ProductOptionGroupDto {
  @IsString() @Length(1, 120) displayName!: string;
  @IsIn(["single", "multi"]) selectionType?: string;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) minSelections?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) maxSelections?: number;
}

class ProductOptionDto {
  @IsString() @Length(1, 120) displayName!: string;
  @IsInt() @Min(0) priceDeltaMinor!: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}

class UpdateProductOptionDto {
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
  @IsOptional() @IsInt() @Min(0) priceDeltaMinor?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class MerchantDocumentDto {
  @IsIn(["business_registration", "tax_identification", "trading_license", "operating_permit", "insurance", "profile_photo"]) documentType!: string;
  @IsString() @Length(3, 500) storageKey!: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class SalesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
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

  @Patch("locations/:locationId/hours")
  @Roles("merchant_staff")
  setLocationHours(@Req() request: AuthenticatedRequest, @Param("locationId", ParseUUIDPipe) locationId: string, @Body() body: LocationHoursDto) {
    return this.service.setLocationHours(requireUser(request).id, locationId, body.openingHours);
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

  @Patch("categories/:categoryId")
  @Roles("merchant_staff")
  updateCategory(@Req() request: AuthenticatedRequest, @Param("categoryId", ParseUUIDPipe) categoryId: string, @Body() body: CategoryUpdateDto) {
    return this.service.updateCategory(requireUser(request).id, categoryId, { displayName: body.displayName, sortOrder: body.sortOrder }, requestId(request));
  }

  @Post("categories/:categoryId/archive")
  @Roles("merchant_staff")
  archiveCategory(@Req() request: AuthenticatedRequest, @Param("categoryId", ParseUUIDPipe) categoryId: string) {
    const user = requireUser(request);
    return this.service.archiveCategory(user.id, categoryId, requestId(request));
  }

  @Post("products")
  @Roles("merchant_staff")
  createProduct(@Req() request: AuthenticatedRequest, @Body() body: CreateProductDto) {
    return this.service.createProduct(requireUser(request).id, body);
  }

  @Patch("products/:productId")
  @Roles("merchant_staff")
  updateProduct(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string, @Body() body: UpdateProductDto) {
    return this.service.updateProduct(requireUser(request).id, productId, body, requestId(request));
  }

  @Patch("products/:productId/inventory")
  @Roles("merchant_staff")
  inventory(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string, @Body() body: InventoryDto) {
    return this.service.setInventory(requireUser(request).id, productId, body.quantity);
  }

  @Get("products/:productId/options")
  @Roles("merchant_staff", "admin")
  listOptions(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string) {
    return this.service.listOptions(requireUser(request).id, productId);
  }

  @Post("products/:productId/options")
  @Roles("merchant_staff")
  createOptionGroup(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string, @Body() body: ProductOptionGroupDto) {
    return this.service.createOptionGroup(requireUser(request).id, productId, { displayName: body.displayName, selectionType: body.selectionType, isRequired: body.isRequired, minSelections: body.minSelections, maxSelections: body.maxSelections }, requestId(request));
  }

  @Post("products/:productId/options/:optionId")
  @Roles("merchant_staff")
  createOption(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string, @Param("optionId", ParseUUIDPipe) optionId: string, @Body() body: ProductOptionDto) {
    return this.service.createOption(requireUser(request).id, productId, optionId, { displayName: body.displayName, priceDeltaMinor: body.priceDeltaMinor, isAvailable: body.isAvailable }, requestId(request));
  }

  @Patch("products/options/:optionId")
  @Roles("merchant_staff")
  updateOption(@Req() request: AuthenticatedRequest, @Param("optionId", ParseUUIDPipe) optionId: string, @Body() body: UpdateProductOptionDto) {
    return this.service.updateOption(requireUser(request).id, optionId, { displayName: body.displayName, priceDeltaMinor: body.priceDeltaMinor, isAvailable: body.isAvailable, isDefault: body.isDefault }, requestId(request));
  }

  @Delete("products/options/:optionId")
  @Roles("merchant_staff")
  deleteOption(@Req() request: AuthenticatedRequest, @Param("optionId", ParseUUIDPipe) optionId: string) {
    return this.service.deleteOption(requireUser(request).id, optionId, requestId(request));
  }

  @Post("products/bulk")
  @Roles("merchant_staff")
  bulkImport(@Req() request: AuthenticatedRequest, @Body() body: BulkImportDto) {
    const user = requireUser(request);
    return this.service.bulkImport(user.id, body.items ?? [], requestId(request));
  }

  @Get("products/export")
  @Roles("merchant_staff", "admin")
  export(@Req() request: AuthenticatedRequest) {
    const user = requireUser(request);
    return this.service.exportProducts(user.id);
  }

  @Post("products/bulk-archive")
  @Roles("merchant_staff")
  bulkArchive(@Req() request: AuthenticatedRequest, @Body() body: BulkArchiveDto) {
    const user = requireUser(request);
    return this.service.bulkArchive(user.id, body.ids ?? [], requestId(request));
  }

  @Post("products/:productId/archive")
  @Roles("merchant_staff")
  archiveProduct(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string) {
    const user = requireUser(request);
    return this.service.archiveProduct(user.id, productId, requestId(request));
  }

  @Post("products/:productId/restore")
  @Roles("merchant_staff")
  restoreProduct(@Req() request: AuthenticatedRequest, @Param("productId", ParseUUIDPipe) productId: string) {
    const user = requireUser(request);
    return this.service.restoreProduct(user.id, productId, requestId(request));
  }

  @Get("settlements")
  @Roles("merchant_staff", "admin")
  settlements(@Req() request: AuthenticatedRequest, @Query() query: PageQuery) {
    return this.service.settlements(requireUser(request).id, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("analytics/sales")
  @Roles("merchant_staff", "admin")
  sales(@Req() request: AuthenticatedRequest, @Query() query: SalesQuery) {
    return this.service.salesSummary(requireUser(request).id, query.days ?? 30);
  }

  @Get("analytics/products")
  @Roles("merchant_staff", "admin")
  productPerformance(@Req() request: AuthenticatedRequest, @Query() query: SalesQuery) {
    return this.service.productPerformance(requireUser(request).id, query.days ?? 30);
  }

  @Get("reviews")
  @Roles("merchant_staff", "admin")
  reviews(@Req() request: AuthenticatedRequest, @Query() query: PageQuery) {
    return this.service.merchantReviews(requireUser(request).id, query.limit ?? 50, query.offset ?? 0);
  }

  @Get("reports/sales.csv")
  @Roles("merchant_staff", "admin")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=merchant-sales.csv")
  async salesReport(@Req() request: AuthenticatedRequest, @Query() query: SalesQuery, @Res() reply: FastifyReply) {
    const csv = await this.service.salesCsv(requireUser(request).id, query.days ?? 30);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="merchant-sales.csv"');
    return reply.send(csv);
  }

  @Get("documents")
  @Roles("merchant_staff", "admin")
  documents(@Req() request: AuthenticatedRequest) {
    return this.service.documents(requireUser(request).id);
  }

  @Post("documents")
  @Roles("merchant_staff")
  addDocument(@Req() request: AuthenticatedRequest, @Body() body: MerchantDocumentDto) {
    return this.service.addDocument(requireUser(request).id, { documentType: body.documentType, storageKey: body.storageKey });
  }
}


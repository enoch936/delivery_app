import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { OptionalSessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { CartService } from "./cart.service.js";
import type { CartOwner } from "./cart.types.js";

class AddItemDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsUUID(undefined, { each: true }) optionIds?: string[];
}

class UpdateItemDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(99) quantity!: number;
}

class MergeCartDto {
  @IsOptional() @IsUUID() merchantId?: string;
}

@ApiTags("cart")
@ApiBearerAuth()
@ApiHeader({ name: "x-device-id", required: false, description: "Stable anonymous device id, used before sign-in." })
@UseGuards(OptionalSessionGuard)
@Controller("v1/cart")
export class CartController {
  constructor(private readonly service: CartService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest, @Headers("x-device-id") deviceId?: string) {
    return this.service.get(owner(request, deviceId));
  }

  @Post("items")
  add(@Req() request: AuthenticatedRequest, @Headers("x-device-id") deviceId: string | undefined, @Body() body: AddItemDto) {
    return this.service.addItem(owner(request, deviceId), body);
  }

  @Patch("items/:itemId")
  update(
    @Req() request: AuthenticatedRequest,
    @Headers("x-device-id") deviceId: string | undefined,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() body: UpdateItemDto
  ) {
    return this.service.updateItem(owner(request, deviceId), itemId, body.quantity);
  }

  @Delete("items/:itemId")
  remove(
    @Req() request: AuthenticatedRequest,
    @Headers("x-device-id") deviceId: string | undefined,
    @Param("itemId", ParseUUIDPipe) itemId: string
  ) {
    return this.service.updateItem(owner(request, deviceId), itemId, 0);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Req() request: AuthenticatedRequest, @Headers("x-device-id") deviceId?: string): Promise<void> {
    await this.service.clear(owner(request, deviceId));
  }

  @Post("reconcile")
  reconcile(@Req() request: AuthenticatedRequest, @Headers("x-device-id") deviceId?: string) {
    return this.service.reconcile(owner(request, deviceId));
  }

  @Post("merge")
  merge(@Req() request: AuthenticatedRequest, @Headers("x-device-id") deviceId: string | undefined) {
    const session = request.authSession;
    if (!session) throw new BadRequestException("Sign in before merging a cart.");
    return this.service.merge({ userId: session.user.id, deviceId: normalizeDeviceId(deviceId) });
  }
}

function owner(request: AuthenticatedRequest, deviceId: string | undefined): CartOwner {
  const session = request.authSession;
  const device = normalizeDeviceId(deviceId);
  if (!session && !device) throw new BadRequestException("Provide a bearer session or an x-device-id header to use a cart.");
  return { userId: session?.user.id ?? null, deviceId: session ? null : device };
}

function normalizeDeviceId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(trimmed)) throw new BadRequestException("x-device-id must be 8-128 characters of [A-Za-z0-9_-].");
  return trimmed;
}

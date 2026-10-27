import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { CartService } from "./cart.service.js";

class AddItemDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity!: number;
}

class UpdateItemDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(99) quantity!: number;
}

@ApiTags("cart")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/cart")
export class CartController {
  constructor(private readonly service: CartService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.service.get(requireUser(request).id);
  }

  @Post("items")
  add(@Req() request: AuthenticatedRequest, @Body() body: AddItemDto) {
    return this.service.addItem(requireUser(request).id, body);
  }

  @Patch("items/:itemId")
  update(@Req() request: AuthenticatedRequest, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() body: UpdateItemDto) {
    return this.service.updateItem(requireUser(request).id, itemId, body.quantity);
  }

  @Delete("items/:itemId")
  remove(@Req() request: AuthenticatedRequest, @Param("itemId", ParseUUIDPipe) itemId: string) {
    return this.service.updateItem(requireUser(request).id, itemId, 0);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.service.clear(requireUser(request).id);
  }
}

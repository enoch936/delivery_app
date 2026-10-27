import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, Length, Matches, MaxLength } from "class-validator";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { requireUser } from "../../common/auth-context.js";
import { AddressesService } from "./addresses.service.js";

class CreateAddressDto {
  @IsString() @Length(1, 40) label!: string;
  @IsString() @Length(2, 120) recipientName!: string;
  @Matches(/^\+[1-9]\d{7,14}$/) phoneE164!: string;
  @IsString() @Length(5, 400) addressLine!: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryInstructions?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class UpdateAddressDto {
  @IsOptional() @IsString() @Length(1, 40) label?: string;
  @IsOptional() @IsString() @Length(2, 120) recipientName?: string;
  @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) phoneE164?: string;
  @IsOptional() @IsString() @Length(5, 400) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryInstructions?: string | null;
  @IsOptional() @IsLatitude() latitude?: number | null;
  @IsOptional() @IsLongitude() longitude?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

@ApiTags("addresses")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/addresses")
export class AddressesController {
  constructor(private readonly service: AddressesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.service.list(requireUser(request).id);
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateAddressDto) {
    return this.service.create(requireUser(request).id, body);
  }

  @Patch(":addressId")
  update(@Req() request: AuthenticatedRequest, @Param("addressId", ParseUUIDPipe) addressId: string, @Body() body: UpdateAddressDto) {
    return this.service.update(requireUser(request).id, addressId, body);
  }

  @Delete(":addressId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() request: AuthenticatedRequest, @Param("addressId", ParseUUIDPipe) addressId: string): Promise<void> {
    await this.service.remove(requireUser(request).id, addressId);
  }
}

import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { DevicesService, type DeviceRegistration } from "./devices.service.js";

class RegisterDeviceDto implements DeviceRegistration {
  @IsString() @MinLength(16) @MaxLength(4096) token!: string;
  @IsIn(["android", "ios", "web", "other"]) platform!: DeviceRegistration["platform"];
  @IsIn(["customer", "courier"]) app!: DeviceRegistration["app"];
  @IsOptional() @IsString() @MaxLength(64) appVersion?: string;
}

@ApiTags("devices")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/devices")
export class DevicesController {
  constructor(private readonly service: DevicesService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@Req() request: AuthenticatedRequest, @Body() body: RegisterDeviceDto): Promise<void> {
    await this.service.register(requireUser(request).id, body);
  }

  @Delete(":token")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(@Req() request: AuthenticatedRequest, @Param("token") token: string): Promise<void> {
    await this.service.unregister(requireUser(request).id, token);
  }
}

import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { SessionGuard } from "../auth/session.guard.js";
import { GeocodingService } from "./geocoding.service.js";

class ForwardQueryDto {
  @IsString()
  q!: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  limit?: number;
}

class ReverseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

@ApiTags("geocoding")
@Controller("v1/geocoding")
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  @Get("forward")
  @ApiOkResponse({ description: "Forward geocode search results." })
  async forward(@Query() query: ForwardQueryDto) {
    return this.geocodingService.forward(query);
  }

  @Get("reverse")
  @ApiOkResponse({ description: "Reverse geocode lookup." })
  async reverse(@Query() query: ReverseDto) {
    return this.geocodingService.reverse(query);
  }

  @Post("reverse")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Reverse geocode lookup (authenticated)." })
  async reversePost(@Body() body: ReverseDto) {
    return this.geocodingService.reverse(body);
  }
}

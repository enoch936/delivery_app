import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested
} from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { MapsService } from "./maps.service.js";
import type { GeoPoint, RouteProfile } from "./maps.types.js";

const PROFILES = ["auto", "motorcycle", "pedestrian", "bicycle"] as const;

class CoordinateDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

class RouteDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(25) @ValidateNested({ each: true }) @Type(() => CoordinateDto)
  locations!: CoordinateDto[];

  @IsOptional() @IsIn(PROFILES) profile?: RouteProfile;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2) alternates?: number;
  @IsOptional() @IsString() @Length(2, 8) language?: string;
}

class MatrixDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CoordinateDto)
  sources!: CoordinateDto[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CoordinateDto)
  targets!: CoordinateDto[];

  @IsOptional() @IsIn(PROFILES) profile?: RouteProfile;
}

class MatchDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CoordinateDto)
  shape!: CoordinateDto[];

  @IsOptional() @IsIn(PROFILES) profile?: RouteProfile;
}

class SearchDto {
  @IsString() @Length(1, 200) q!: string;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}

class ReverseDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

class NearbyDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(20_000) radiusMeters?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() kinds?: string;
}

class BuildingsQueryDto {
  @IsString() bbox!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5_000) limit?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.001) simplify?: number;
}

@ApiTags("maps")
@Controller("v1/maps")
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get("config")
  @ApiOkResponse({ description: "Map, routing, geocoding and tracking client configuration." })
  config() {
    return this.maps.config();
  }

  @Get("styles/:style/style.json")
  @ApiOkResponse({ description: "MapLibre style JSON for standard, hybrid or satellite." })
  style(@Param("style") style: string) {
    return this.maps.style(style);
  }

  @Get("search")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  search(@Query() query: SearchDto) {
    return this.maps.search(query.q, query.limit ?? 5, query.countryCode);
  }

  @Get("reverse")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  reverse(@Query() query: ReverseDto) {
    return this.maps.reverse(query.latitude, query.longitude);
  }

  @Post("route")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  route(@Body() body: RouteDto) {
    return this.maps.route({
      locations: body.locations.map(toPoint),
      profile: body.profile ?? "auto",
      alternates: body.alternates ?? 0,
      language: body.language ?? "en"
    });
  }

  @Post("matrix")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  matrix(@Body() body: MatrixDto) {
    return this.maps.matrix({
      sources: body.sources.map(toPoint),
      targets: body.targets.map(toPoint),
      profile: body.profile ?? "auto"
    });
  }

  @Post("match")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  match(@Body() body: MatchDto) {
    return this.maps.match({ shape: body.shape.map(toPoint), profile: body.profile ?? "auto" });
  }

  @Get("buildings")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  buildings(@Query() query: BuildingsQueryDto) {
    const parts = query.bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
      throw new BadRequestException("bbox must be minLng,minLat,maxLng,maxLat.");
    }
    const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
    if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
      throw new BadRequestException("bbox coordinates are out of range.");
    }
    return this.maps.buildings([minLng, minLat, maxLng, maxLat], query.limit ?? 2_000, query.simplify ?? 0.00002);
  }

  @Get("nearby")
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  nearby(@Query() query: NearbyDto) {
    const allowed = new Set(["merchant", "building", "access_point"]);
    const kinds = (query.kinds ?? "merchant,access_point")
      .split(",")
      .map((kind) => kind.trim())
      .filter((kind) => allowed.has(kind)) as ("merchant" | "building" | "access_point")[];
    if (kinds.length === 0) throw new BadRequestException("kinds must include merchant, building or access_point.");
    return this.maps.nearby({
      latitude: query.latitude,
      longitude: query.longitude,
      radiusMeters: query.radiusMeters ?? 1_000,
      limit: query.limit ?? 50,
      kinds
    });
  }
}

@ApiTags("deliveries")
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller("v1/deliveries")
export class DeliveryMapsController {
  constructor(private readonly maps: MapsService) {}

  @Get(":orderId/route")
  @ApiOkResponse({ description: "Server-calculated pickup-to-dropoff route for an accessible delivery." })
  route(@Req() request: AuthenticatedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const user = requireUser(request);
    return this.maps.deliveryRoute(orderId, { userId: user.id, roles: user.roles });
  }
}

function toPoint(point: CoordinateDto): GeoPoint {
  return { latitude: point.latitude, longitude: point.longitude };
}

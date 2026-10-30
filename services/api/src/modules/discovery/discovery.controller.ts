import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
import { requireUser } from "../../common/auth-context.js";
import { OptionalSessionGuard, SessionGuard, type AuthenticatedRequest } from "../auth/session.guard.js";
import { DiscoveryService } from "./discovery.service.js";

const SORTS = ["recommended", "distance", "rating", "eta", "name"] as const;
const SEARCH_TYPES = ["all", "merchant", "product", "service"] as const;

class LocationQuery {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng?: number;
}

class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class DiscoveryQuery extends PaginationQuery {
  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsIn(SORTS)
  sort?: (typeof SORTS)[number];

  @IsOptional() @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  openNow?: boolean;

  @IsOptional() @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  favorites?: boolean;
}

class MerchantListQuery extends DiscoveryQuery implements LocationQuery {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng?: number;
}

class SearchQuery extends PaginationQuery implements LocationQuery {
  @IsString() @Length(1, 120)
  q!: string;

  @IsOptional() @IsIn(SEARCH_TYPES)
  type?: (typeof SEARCH_TYPES)[number];

  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsIn(SORTS)
  sort?: (typeof SORTS)[number];

  @IsOptional() @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  openNow?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng?: number;
}

class SearchSuggestionQuery {
  @IsOptional() @IsString() @Length(0, 120)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  limit?: number;
}

class RecentSearchDto {
  @IsString() @Length(1, 120) @Matches(/\S/)
  term!: string;
}

class ProductListQuery extends MerchantListQuery {}

@ApiTags("discovery")
@Controller("v1")
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get("service-categories")
  @ApiOkResponse({ description: "Active service categories for the launch market." })
  async serviceCategories() {
    const items = await this.discoveryService.listServiceCategories();
    return { items };
  }

  @Get("discovery/home")
  @UseGuards(OptionalSessionGuard)
  @ApiOkResponse({ description: "Personalized home feed with banners, categories, featured merchants and recommendations." })
  home(@Req() request: AuthenticatedRequest, @Query() query: LocationQuery) {
    return this.discoveryService.home({
      userId: request.authSession?.user.id ?? null,
      latitude: query.lat,
      longitude: query.lng
    });
  }

  @Get("merchants")
  @UseGuards(OptionalSessionGuard)
  @ApiOkResponse({ description: "Merchants available in the configured launch city." })
  async merchants(@Req() request: AuthenticatedRequest, @Query() query: MerchantListQuery) {
    return this.discoveryService.listMerchants({
      categorySlug: query.category,
      q: query.q,
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      openNow: query.openNow,
      favoritesOnly: query.favorites,
      latitude: query.lat,
      longitude: query.lng,
      userId: request.authSession?.user.id
    });
  }

  @Get("merchants/:merchantId")
  @ApiOkResponse({ description: "Merchant storefront details." })
  merchant(@Param("merchantId", ParseUUIDPipe) merchantId: string, @Query() query: LocationQuery) {
    return this.discoveryService.getMerchant(merchantId, query.lat, query.lng);
  }

  @Get("merchants/:merchantId/products")
  @ApiOkResponse({ description: "Products offered by a merchant." })
  async products(@Param("merchantId", ParseUUIDPipe) merchantId: string, @Query() query: ProductListQuery) {
    await this.discoveryService.getMerchant(merchantId, query.lat, query.lng);
    return this.discoveryService.listProducts(merchantId, { q: query.q, limit: query.limit, offset: query.offset });
  }

  @Get("search")
  @UseGuards(OptionalSessionGuard)
  @ApiOkResponse({ description: "Search merchants, products and services in the launch city." })
  search(@Query() query: SearchQuery) {
    return this.discoveryService.search({
      q: query.q,
      type: query.type,
      categorySlug: query.category,
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      openNow: query.openNow,
      latitude: query.lat,
      longitude: query.lng
    });
  }

  @Get("search/suggestions")
  @UseGuards(OptionalSessionGuard)
  @ApiOkResponse({ description: "Typeahead suggestions across merchants, products and services, plus recent terms." })
  suggestions(@Req() request: AuthenticatedRequest, @Query() query: SearchSuggestionQuery) {
    return this.discoveryService.suggestions({
      q: query.q ?? "",
      limit: query.limit,
      userId: request.authSession?.user.id
    });
  }

  @Get("search/recent")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  async recentSearches(@Req() request: AuthenticatedRequest) {
    return { items: await this.discoveryService.listRecentSearches(requireUser(request).id) };
  }

  @Post("search/recent")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async recordRecentSearch(@Req() request: AuthenticatedRequest, @Body() body: RecentSearchDto) {
    await this.discoveryService.recordRecentSearch(requireUser(request).id, body.term);
    return { recorded: true };
  }

  @Delete("search/recent")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  async clearRecentSearches(@Req() request: AuthenticatedRequest) {
    await this.discoveryService.clearRecentSearches(requireUser(request).id);
    return { cleared: true };
  }

  @Get("favorites")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  async favorites(@Req() request: AuthenticatedRequest, @Query() query: LocationQuery) {
    return { items: await this.discoveryService.listFavorites(requireUser(request).id, query.lat, query.lng) };
  }

  @Post("favorites/:merchantId")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async addFavorite(@Req() request: AuthenticatedRequest, @Param("merchantId", ParseUUIDPipe) merchantId: string) {
    await this.discoveryService.getMerchant(merchantId);
    await this.discoveryService.addFavorite(requireUser(request).id, merchantId);
    return { favorite: true };
  }

  @Delete("favorites/:merchantId")
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  async removeFavorite(@Req() request: AuthenticatedRequest, @Param("merchantId", ParseUUIDPipe) merchantId: string) {
    const favorite = await this.discoveryService.removeFavorite(requireUser(request).id, merchantId);
    return { favorite, removed: favorite };
  }
}

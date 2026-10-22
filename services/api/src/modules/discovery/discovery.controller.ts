import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { DiscoveryService } from "./discovery.service.js";

class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

class MerchantListQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

class SearchQuery extends PaginationQuery {
  @IsString()
  q!: string;
}

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

  @Get("merchants")
  @ApiOkResponse({ description: "Merchants available in the configured launch city." })
  async merchants(@Query() query: MerchantListQuery) {
    return this.discoveryService.listMerchants({ categorySlug: query.category, q: query.q, limit: query.limit, offset: query.offset });
  }

  @Get("merchants/:merchantId")
  @ApiOkResponse({ description: "Merchant storefront details." })
  async merchant(@Param("merchantId", ParseUUIDPipe) merchantId: string) {
    return this.discoveryService.getMerchant(merchantId);
  }

  @Get("merchants/:merchantId/products")
  @ApiOkResponse({ description: "Products offered by a merchant." })
  async products(@Param("merchantId", ParseUUIDPipe) merchantId: string, @Query() query: PaginationQuery & { q?: string }) {
    await this.discoveryService.getMerchant(merchantId);
    return this.discoveryService.listProducts(merchantId, { q: query.q, limit: query.limit, offset: query.offset });
  }

  @Get("search")
  @ApiOkResponse({ description: "Search merchants and products in the launch city." })
  async search(@Query() query: SearchQuery) {
    return this.discoveryService.search({ q: query.q, limit: query.limit, offset: query.offset });
  }
}

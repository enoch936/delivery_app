import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { DiscoveryService } from "../discovery/discovery.service.js";

@ApiTags("platform")
@Controller("v1/platform")
export class PlatformController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get("configuration")
  @ApiOkResponse({ description: "Safe, public launch configuration." })
  async configuration() {
    const config = readRuntimeConfig();
    return {
      countryCode: config.launchCountryCode,
      launchCitySlug: config.launchCitySlug,
      defaultCurrency: config.defaultCurrency,
      enabledServiceCategories: await this.discoveryService.enabledCategorySlugs()
    };
  }
}

import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { readRuntimeConfig } from "../../config/runtime-config.js";

@ApiTags("platform")
@Controller("v1/platform")
export class PlatformController {
  @Get("configuration")
  @ApiOkResponse({ description: "Safe, public launch configuration." })
  configuration() {
    const config = readRuntimeConfig();
    return {
      countryCode: config.launchCountryCode,
      launchCitySlug: config.launchCitySlug,
      defaultCurrency: config.defaultCurrency,
      enabledServiceCategories: []
    };
  }
}

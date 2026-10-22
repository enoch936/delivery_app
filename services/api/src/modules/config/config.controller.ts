import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "./config.service.js";

@Controller("api/v1/config")
export class ConfigController {
  constructor(private readonly service: ConfigService) {}
  @Get("feature-flags")
  flags() { return this.service.featureFlags(); }
}
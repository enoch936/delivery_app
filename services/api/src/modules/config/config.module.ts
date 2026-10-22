import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { ConfigController } from "./config.controller.js";
import { ConfigService } from "./config.service.js";
import { RUNTIME_CONFIG } from "./config.types.js";

@Module({
  controllers: [ConfigController],
  providers: [ConfigService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [ConfigService]
})
export class ConfigModule {}
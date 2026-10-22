import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { DiscoveryController } from "./discovery.controller.js";
import { DiscoveryService } from "./discovery.service.js";
import { DISCOVERY_REPOSITORY, RUNTIME_CONFIG } from "./discovery.types.js";
import { PostgresDiscoveryRepository } from "./postgres-discovery.repository.js";

@Module({
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    PostgresDiscoveryRepository,
    { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig },
    { provide: DISCOVERY_REPOSITORY, useExisting: PostgresDiscoveryRepository }
  ],
  exports: [DiscoveryService]
})
export class DiscoveryModule {}

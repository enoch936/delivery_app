import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { AddressesController } from "./addresses.controller.js";
import { AddressesService } from "./addresses.service.js";
import { RUNTIME_CONFIG } from "./addresses.types.js";

@Module({
  controllers: [AddressesController],
  providers: [AddressesService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [AddressesService]
})
export class AddressesModule {}
import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { LedgerController } from "./ledger.controller.js";
import { LedgerService } from "./ledger.service.js";
import { RUNTIME_CONFIG } from "./ledger.types.js";

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [LedgerService]
})
export class LedgerModule {}
import { Module } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { ReviewsController } from "./reviews.controller.js";
import { ReviewsService } from "./reviews.service.js";
import { RUNTIME_CONFIG } from "./reviews.types.js";

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, { provide: RUNTIME_CONFIG, useFactory: readRuntimeConfig }],
  exports: [ReviewsService]
})
export class ReviewsModule {}
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { GeocodingController } from "./geocoding.controller.js";
import { GeocodingService } from "./geocoding.service.js";

@Module({
  imports: [AuthModule],
  controllers: [GeocodingController],
  providers: [GeocodingService],
  exports: [GeocodingService]
})
export class GeocodingModule {}

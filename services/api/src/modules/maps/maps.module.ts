import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { GeocodingModule } from "../geocoding/geocoding.module.js";
import { DeliveryMapsController, MapsController } from "./maps.controller.js";
import { MapsService } from "./maps.service.js";
import { MapStyleService } from "./map-style.service.js";

@Module({
  imports: [AuthModule, GeocodingModule],
  controllers: [MapsController, DeliveryMapsController],
  providers: [MapsService, MapStyleService],
  exports: [MapsService, MapStyleService]
})
export class MapsModule {}

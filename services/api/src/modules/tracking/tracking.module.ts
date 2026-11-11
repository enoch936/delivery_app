import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DeliveryTrackingController, TrackingController } from "./tracking.controller.js";
import { TrackingService } from "./tracking.service.js";

@Module({
  imports: [AuthModule],
  controllers: [TrackingController, DeliveryTrackingController],
  providers: [TrackingService],
  exports: [TrackingService]
})
export class TrackingModule {}

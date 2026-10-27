import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TrackingController } from "./tracking.controller.js";
import { TrackingService } from "./tracking.service.js";

@Module({ imports: [AuthModule], controllers: [TrackingController], providers: [TrackingService], exports: [TrackingService] })
export class TrackingModule {}

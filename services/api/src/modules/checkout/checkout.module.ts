import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { MapsModule } from "../maps/maps.module.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutService } from "./checkout.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, MapsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService]
})
export class CheckoutModule {}



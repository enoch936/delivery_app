import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { CartController } from "./cart.controller.js";
import { CartService } from "./cart.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService]
})
export class CartModule {}


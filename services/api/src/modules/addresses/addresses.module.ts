import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AddressesController } from "./addresses.controller.js";
import { AddressesService } from "./addresses.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService]
})
export class AddressesModule {}


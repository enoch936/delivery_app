import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BusinessController } from "./business.controller.js";
import { BusinessService } from "./business.service.js";

@Module({ imports: [AuthModule], controllers: [BusinessController], providers: [BusinessService], exports: [BusinessService] })
export class BusinessModule {}

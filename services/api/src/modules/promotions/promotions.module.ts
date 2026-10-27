import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PromotionsController } from "./promotions.controller.js";
import { PromotionsService } from "./promotions.service.js";

@Module({ imports: [AuthModule], controllers: [PromotionsController], providers: [PromotionsService], exports: [PromotionsService] })
export class PromotionsModule {}

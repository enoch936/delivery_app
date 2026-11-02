import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CommonModule } from "../../common/common.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { OperatorController } from "./operator.controller.js";
import { OperatorService } from "./operator.service.js";

@Module({ imports: [AuthModule, CommonModule, DatabaseModule], controllers: [OperatorController], providers: [OperatorService] })
export class OperatorModule {}

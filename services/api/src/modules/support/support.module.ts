import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupportController } from "./support.controller.js";
import { SupportService } from "./support.service.js";

@Module({ imports: [AuthModule], controllers: [SupportController], providers: [SupportService], exports: [SupportService] })
export class SupportModule {}

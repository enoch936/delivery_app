import { Module } from "@nestjs/common";
import { DiscoveryModule } from "../discovery/discovery.module.js";
import { PlatformController } from "./platform.controller.js";

@Module({ imports: [DiscoveryModule], controllers: [PlatformController] })
export class PlatformModule {}

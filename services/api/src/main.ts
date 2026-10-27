import "dotenv/config";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { readRuntimeConfig } from "./config/runtime-config.js";
import { startTrackingGateway } from "./modules/tracking/tracking.gateway.js";

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig();
  const app = await createApp(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  startTrackingGateway(app);
  new Logger("Bootstrap").log(`API listening on port ${config.port} in ${config.nodeEnv} mode.`);
}

void bootstrap();

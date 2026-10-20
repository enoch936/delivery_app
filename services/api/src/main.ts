import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module.js";
import { readRuntimeConfig } from "./config/runtime-config.js";

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: config.nodeEnv === "production" }));
  app.enableCors({ origin: [...config.corsOrigins], credentials: true, allowedHeaders: ["content-type", "authorization", "idempotency-key", "x-request-id"] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().addHook("onRequest", (request, reply, done) => {
    const requestId = typeof request.headers["x-request-id"] === "string" ? request.headers["x-request-id"] : randomUUID();
    reply.header("x-request-id", requestId);
    done();
  });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Kora Delivery API").setDescription("Versioned API contracts for the Kora delivery platform.").setVersion("0.1.0").build());
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "docs/openapi.json" });
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

void bootstrap();

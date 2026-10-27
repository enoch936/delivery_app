import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module.js";
import { GlobalHttpExceptionFilter } from "./common/http-exception.filter.js";
import { readRuntimeConfig, type RuntimeConfig } from "./config/runtime-config.js";

export async function createApp(config: RuntimeConfig = readRuntimeConfig()): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: config.nodeEnv === "production" ? { level: "info" } : false,
    bodyLimit: 1_048_576,
    trustProxy: true,
    requestIdHeader: "x-request-id"
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true, rawBody: true });
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "idempotency-key", "x-request-id"],
    maxAge: 600
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: false } }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.enableShutdownHooks();

  const instance = app.getHttpAdapter().getInstance();
  instance.addHook("onRequest", (request, reply, done) => {
    const incoming = request.headers["x-request-id"];
    const id = typeof incoming === "string" && /^[A-Za-z0-9-]{8,128}$/.test(incoming) ? incoming : randomUUID();
    request.headers["x-request-id"] = id;
    reply.header("x-request-id", id);
    done();
  });
  instance.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
    reply.header("Cache-Control", "no-store");
    if (config.nodeEnv === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    done(null, payload);
  });

  if (config.nodeEnv !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("delivery_app API")
        .setDescription("Versioned API contracts for delivery_app. All protected routes require an opaque bearer session.")
        .setVersion("1.0.0")
        .addBearerAuth()
        .build()
    );
    SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "docs/openapi.json" });
  }

  return app;
}

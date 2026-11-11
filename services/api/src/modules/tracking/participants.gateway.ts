import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthSession } from "../auth/auth.types.js";
import { TrackingService } from "./tracking.service.js";

const PARTICIPANTS_PATH = /^\/api\/v1\/tracking\/participants\/ws$/;
const HEARTBEAT_INTERVAL_MS = 30_000;

export function startParticipantsGateway(app: NestFastifyApplication): void {
  const authService = app.get(AuthService);
  const trackingService = app.get(TrackingService);
  const logger = new Logger("ParticipantsGateway");
  const server = app.getHttpAdapter().getInstance().server as Server;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8_192 });
  const updateIntervalMs = readRuntimeConfig().trackingActiveIntervalSeconds * 1_000;

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!PARTICIPANTS_PATH.test(path)) return;

    socket.on("error", () => undefined);
    const token = bearerToken(request);
    if (!token) {
      rejectUpgrade(socket, 401, "A valid bearer session is required.");
      return;
    }

    void authService
      .authenticate(token)
      .then(async (session) => {
        const snapshot = await trackingService.participants(viewerFromSession(session));
        sockets.handleUpgrade(request, socket, head, (client) => {
          sockets.emit("connection", client, request, { session, snapshot });
        });
      })
      .catch(() => rejectUpgrade(socket, 401, "Authentication failed."));
  });

  sockets.on(
    "connection",
    (client: WebSocket, _request: IncomingMessage, context: { session: AuthSession; snapshot: unknown }) => {
      let closed = false;
      let lastPayload = "";
      let alive = true;

      const send = (payload: unknown): void => {
        if (closed || client.readyState !== WebSocket.OPEN) return;
        const serialized = JSON.stringify(payload);
        if (serialized === lastPayload) return;
        lastPayload = serialized;
        client.send(serialized);
      };

      const close = (code: number, reason: string): void => {
        if (closed) return;
        closed = true;
        clearInterval(updateTimer);
        clearInterval(heartbeatTimer);
        if (client.readyState === WebSocket.OPEN) client.close(code, reason);
      };

      const updateTimer = setInterval(() => {
        if (closed) return;
        if (Date.now() >= context.session.expiresAt.getTime()) {
          close(4401, "Session expired.");
          return;
        }
        void trackingService
          .participants(viewerFromSession(context.session))
          .then((snapshot) => send({ type: "participants", data: snapshot }))
          .catch((error: unknown) => {
            logger.warn(`Participant subscription failed: ${error instanceof Error ? error.message : "unknown error"}`);
            close(1011, "Tracking is temporarily unavailable.");
          });
      }, updateIntervalMs);

      const heartbeatTimer = setInterval(() => {
        if (!alive) {
          close(1001, "Connection timed out.");
          return;
        }
        alive = false;
        if (client.readyState === WebSocket.OPEN) client.ping();
      }, HEARTBEAT_INTERVAL_MS);

      client.on("pong", () => {
        alive = true;
      });
      client.on("close", () => {
        closed = true;
        clearInterval(updateTimer);
        clearInterval(heartbeatTimer);
      });
      client.on("error", () => {
        closed = true;
        clearInterval(updateTimer);
        clearInterval(heartbeatTimer);
      });

      send({ type: "snapshot", data: context.snapshot });
    }
  );

  server.on("close", () => sockets.close());
  logger.log("Participant WebSocket gateway attached at /api/v1/tracking/participants/ws.");
}

function viewerFromSession(session: AuthSession): Readonly<{ userId: string; roles: readonly string[] }> {
  return { userId: session.user.id, roles: session.user.roles };
}

function bearerToken(request: IncomingMessage): string | null {
  const queryToken = new URL(request.url ?? "/", "http://localhost").searchParams.get("access_token");
  if (queryToken && queryToken.length >= 32) return queryToken;
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.length >= 32 ? token : null;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: { code: "UNAUTHORIZED", message } });
  socket.write(
    `HTTP/1.1 ${status} Unauthorized\r\n` +
      "Connection: close\r\nContent-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
  socket.destroy();
}

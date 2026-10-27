import { HttpException, Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { AuthService } from "../auth/auth.service.js";
import type { AuthSession } from "../auth/auth.types.js";
import { TrackingService } from "./tracking.service.js";

const TRACKING_PATH = /^\/api\/v1\/tracking\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/ws$/i;
const UPDATE_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

type TrackingViewer = Readonly<{ userId: string; roles: readonly string[] }>;

export function startTrackingGateway(app: NestFastifyApplication): void {
  const authService = app.get(AuthService);
  const trackingService = app.get(TrackingService);
  const logger = new Logger("TrackingGateway");
  const server = app.getHttpAdapter().getInstance().server as Server;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8_192 });

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const match = TRACKING_PATH.exec(path);
    if (!match) return;

    socket.on("error", () => undefined);
    const token = bearerToken(request);
    if (!token) {
      rejectUpgrade(socket, 401, "A valid bearer session is required.");
      return;
    }

    void authorize(authService, trackingService, match[1]!, token)
      .then(({ session, snapshot }) => {
        sockets.handleUpgrade(request, socket, head, (client) => {
          sockets.emit("connection", client, request, { session, snapshot });
        });
      })
      .catch((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 401;
        rejectUpgrade(socket, status, status === 403 ? "You cannot track this order." : status === 404 ? "Order not found." : "Authentication failed.");
      });
  });

  sockets.on("connection", (client: WebSocket, _request: IncomingMessage, context: { session: AuthSession; snapshot: unknown }) => {
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
        .track(orderIdFromSnapshot(context.snapshot), viewerFromSession(context.session))
        .then((snapshot) => send({ type: "tracking", data: snapshot }))
        .catch((error: unknown) => {
          logger.warn(`Tracking subscription failed: ${error instanceof Error ? error.message : "unknown error"}`);
          close(1011, "Tracking is temporarily unavailable.");
        });
    }, UPDATE_INTERVAL_MS);

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
  });

  server.on("close", () => sockets.close());
  logger.log("Tracking WebSocket gateway attached at /api/v1/tracking/:orderId/ws.");
}

async function authorize(authService: AuthService, trackingService: TrackingService, orderId: string, token: string): Promise<{ session: AuthSession; snapshot: unknown }> {
  const session = await authService.authenticate(token);
  const snapshot = await trackingService.track(orderId, viewerFromSession(session));
  return { session, snapshot };
}

function viewerFromSession(session: AuthSession): TrackingViewer {
  return { userId: session.user.id, roles: session.user.roles };
}

function orderIdFromSnapshot(snapshot: unknown): string {
  if (typeof snapshot === "object" && snapshot !== null && "orderId" in snapshot && typeof snapshot.orderId === "string") return snapshot.orderId;
  throw new Error("Tracking snapshot is missing an order id.");
}

function bearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.length >= 32 ? token : null;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: { code: status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "UNAUTHORIZED", message } });
  socket.write(
    `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Unauthorized"}\r\n` +
      "Connection: close\r\nContent-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
  socket.destroy();
}

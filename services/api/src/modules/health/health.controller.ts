import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { DatabaseService } from "../../database/database.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get("live")
  @ApiOkResponse({ description: "The API process is running." })
  live(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @ApiOkResponse({ description: "The API process can serve persisted requests." })
  async ready(): Promise<{ status: "ok"; checks: { database: "ok" }; timestamp: string }> {
    const db = (this as any).database ?? (this as any).db;
    if (!db || typeof db.isReady !== "function") throw new ServiceUnavailableException("Readiness checks failed.");
    if (!(await db.isReady())) throw new ServiceUnavailableException("Readiness checks failed.");
    return { status: "ok", checks: { database: "ok" }, timestamp: new Date().toISOString() };
  }
}

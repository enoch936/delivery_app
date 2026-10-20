import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get("live")
  @ApiOkResponse({ description: "The API process is running." })
  live(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @ApiOkResponse({ description: "The API process has completed startup checks." })
  ready(): { status: "ok"; timestamp: string } {
    // Database and queue readiness are added with their adapters in Milestone 1.
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}

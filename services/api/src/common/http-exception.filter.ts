import { Catch, ArgumentsHost, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "./error-codes.js";

type ErrorBody = {
  statusCode: number;
  message: string | string[];
  error?: string;
};

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest & { headers: Record<string, unknown> }>();
    const requestId = (request.headers["x-request-id"] as string) ?? null;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";
    let code = ErrorCode.INTERNAL_SERVER_ERROR;
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as ErrorBody | string;
      if (typeof body === "string") {
        message = body;
      } else {
        message = body.message ?? exception.message;
        details = body.error ? { error: body.error } : undefined;
      }
      code = this.mapStatus(status);
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack);
    }

    if (Array.isArray(message)) {
      code = ErrorCode.VALIDATION_FAILED;
      details = message;
      message = "Validation failed";
    }

    response.status(status).send({
      success: false,
      error: {
        code,
        message,
        details
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        version: "1.0.0"
      }
    });
  }

  private mapStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.TOO_MANY_REQUESTS;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.UNPROCESSABLE_ENTITY;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }
}

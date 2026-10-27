export type ApiMeta = {
  requestId?: string | null;
  timestamp: string;
  version?: string;
};

export type ApiResponse<T> = {
  success: true;
  data: T;
  meta: ApiMeta;
};

export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ApiMeta;
};

export function ok<T>(data: T, meta?: Partial<ApiMeta>): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      ...meta
    }
  };
}

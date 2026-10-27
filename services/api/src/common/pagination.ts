import { BadRequestException } from "@nestjs/common";

export const MAX_PAGE_SIZE = 100;

export function parsePagination(query: { limit?: number; offset?: number }, defaultLimit = 20): { limit: number; offset: number } {
  const limit = query.limit ?? defaultLimit;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new BadRequestException(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  if (!Number.isInteger(offset) || offset < 0) throw new BadRequestException("offset must be zero or greater.");
  return { limit, offset };
}

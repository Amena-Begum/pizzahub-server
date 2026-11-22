import { isValidObjectId } from "mongoose";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (message = "We could not find what you were looking for.") => new HttpError(404, message);
export const forbidden = (message = "Forbidden: you do not have permission to do this.") => new HttpError(403, message);
export const conflict = (message: string) => new HttpError(409, message);

export function assertObjectId(id: unknown, label = "id"): string {
  if (typeof id !== "string" || !isValidObjectId(id)) throw badRequest(`Invalid ${label}.`);
  return id;
}

// Parses untrusted input with a zod schema and turns problems into a readable 400 response.
export function validate<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "body";
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.values(fields)[0] ?? "Invalid request data.";
    throw badRequest(first, fields);
  }
  return result.data;
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pageParams(query: Record<string, unknown>, defaultLimit = 12, maxLimit = 50) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(String(query.limit ?? defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (m = "Authentication required") => new AppError(401, "UNAUTHORIZED", m);
export const forbidden = (m = "You do not have permission for this action") => new AppError(403, "FORBIDDEN", m);
export const notFound = (m = "Not found") => new AppError(404, "NOT_FOUND", m);
export const conflict = (m: string) => new AppError(409, "CONFLICT", m);
export const badRequest = (m: string, details?: unknown) => new AppError(400, "BAD_REQUEST", m, details);
export const planLimit = (m: string) => new AppError(402, "PLAN_LIMIT", m);

import { Context } from "hono";

/**
 * Standardized API Response Utility
 */
export const apiResponse = {
  success: <T>(c: Context, data: T | null = null, status: number = 200) => {
    return c.json(
      {
        success: true,
        data,
      },
      status as any,
    );
  },
  error: (c: Context, message: string, status: number = 400, details: unknown = null) => {
    return c.json(
      {
        success: false,
        error: message,
        details: details || null,
      },
      status as any,
    );
  },
};

/**
 * Simple Debug Logger
 * Uses the DEBUG environment variable to determine whether to output logs.
 */

const IS_DEBUG = process.env.DEBUG === "true";

export const logger = {
  debug: (...args: unknown[]) => {
    if (IS_DEBUG) {
      console.log(`[DEBUG] [${new Date().toISOString()}]`, ...args);
    }
  },
  info: (...args: unknown[]) => {
    console.log(`[INFO] [${new Date().toISOString()}]`, ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(`[WARN] [${new Date().toISOString()}]`, ...args);
  },
  error: (...args: unknown[]) => {
    console.error(`[ERROR] [${new Date().toISOString()}]`, ...args);
  },
};

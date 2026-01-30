import { Hono } from "hono";
import db from "../db";
import { backupDatabase } from "../lib/backup";
import { logger } from "../lib/logger";
import { apiResponse } from "../lib/response";
import { SystemStats } from "../types";

const system = new Hono();

/**
 * System Health & Diagnostics
 */
// Cache health status to avoid rate limits and reduce latency
let lastCheck = 0;
let cachedDiscordStatus = "unknown";
const CACHE_TTL = 30000; // 30 seconds

system.get("/health", async (c) => {
  const now = Date.now();
  const stats: SystemStats = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: "offline",
    discord: "checking", // Will be overwritten
    version: "2.0",
    debug: process.env.DEBUG === "true",
  };

  try {
    // 1. Check SQLite (Fast enough to run every time)
    const result = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    if (result && result.ok === 1) {
      stats.database = "online";
    }
  } catch (error) {
    logger.error("DB Health Check Failed:", error);
    stats.database = "error";
  }

  // 2. Check Discord Connectivity (Cached)
  if (now - lastCheck > CACHE_TTL || cachedDiscordStatus === "unknown") {
    try {
      const start = Date.now();
      const discordRes = await fetch("https://discord.com/api/v10/gateway", {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
      });

      if (discordRes.ok) {
        const latency = Date.now() - start;
        cachedDiscordStatus = `online (${latency}ms)`;
      } else {
        cachedDiscordStatus = `unauthorized/failed (${discordRes.status})`;
      }
    } catch (error) {
      logger.error("Discord Health Check Failed:", error);
      cachedDiscordStatus = "unreachable";
    }
    lastCheck = now;
  }

  stats.discord = cachedDiscordStatus;

  return apiResponse.success<SystemStats>(c, stats);
});

/**
 * Storage Statistics
 */
system.get("/stats", async (c) => {
  try {
    const stats = db
      .prepare(
        `
      SELECT
        COUNT(*) as totalFiles,
        COALESCE(SUM(size), 0) as totalSize
      FROM files
      WHERE status = 'active'
    `,
      )
      .get() as { totalFiles: number; totalSize: number };

    return apiResponse.success(c, {
      storage: stats,
      dbSize: await Bun.file("neko.db").size,
    });
  } catch (error: unknown) {
    logger.error("Stats Error:", error);
    return apiResponse.error(c, "Failed to fetch storage stats", 500);
  }
});

/**
 * Trigger manual redundant backup
 */
system.post("/backup", async (c) => {
  try {
    logger.info("Manual backup triggered via API");
    // Run in background to avoid blocking the user
    backupDatabase().catch((err: unknown) => {
      logger.error("Background manual backup failed:", err);
    });

    return apiResponse.success(c, { message: "Backup initiative started." });
  } catch (error: unknown) {
    logger.error("Manual Backup Trigger Error:", error);
    return apiResponse.error(c, "Failed to initiate backup", 500);
  }
});

export default system;

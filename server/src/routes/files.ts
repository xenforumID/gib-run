import { Hono } from "hono";
import db from "../db";
import { backupDatabase } from "../lib/backup";
import { bulkDeleteFromDiscord } from "../lib/discord";
import { logger } from "../lib/logger";
import { apiResponse } from "../lib/response";
import { ChunkMetadata, FileMetadata, PaginatedResponse } from "../types";

const files = new Hono();

/**
 * List all active files (with Pagination)
 */
files.get("/", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");
    const status = c.req.query("status") || "active"; // 'active' or 'trashed'

    logger.debug(`Listing files (status: ${status}, limit: ${limit}, offset: ${offset})`);

    const allFiles = db
      .prepare(
        `SELECT f.id, f.name, f.size, f.type, f.iv, f.salt, f.status, (f.created_at * 1000) as createdAt,
         (SELECT COUNT(*) FROM chunks WHERE file_id = f.id) as chunks
         FROM files f
         WHERE f.status = ?
         ORDER BY f.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(status, limit, offset) as FileMetadata[];
    const total = (db.prepare("SELECT COUNT(*) as count FROM files WHERE status = ?").get(status) as { count: number })
      .count;

    return apiResponse.success<PaginatedResponse<FileMetadata>>(c, {
      items: allFiles,
      total,
      limit,
      offset,
    });
  } catch (error: unknown) {
    logger.error("Failed to list files:", error);
    return apiResponse.error(c, "Failed to list files", 500);
  }
});

/**
 * Search files using FTS5 (Filtered by Status)
 */
files.get("/search", async (c) => {
  const query = c.req.query("q");
  const status = c.req.query("status") || "active";

  if (!query) {
    return c.redirect(`/api/files?status=${status}`);
  }

  try {
    logger.debug(`Searching files for: "${query}" (status: ${status})`);
    const results = db
      .prepare(
        `
      SELECT f.id, f.name, f.size, f.type, f.iv, f.salt, f.status, (f.created_at * 1000) as createdAt
      FROM files f
      JOIN files_fts fts ON f.id = fts.id
      WHERE files_fts MATCH ? AND f.status = ?
      ORDER BY rank
    `,
      )
      .all(`"${query.replace(/"/g, '""')}"*`, status) as FileMetadata[];

    return apiResponse.success<FileMetadata[]>(c, results);
  } catch (error: unknown) {
    logger.error(`Search error for "${query}":`, error);
    return apiResponse.error(c, "Search failed", 500);
  }
});

/**
 * Get file details including chunk mapping
 */
files.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    logger.debug(`Fetching file details for ${id}`);
    const file = db
      .prepare(
        "SELECT id, name, size, type, iv, salt, status, (created_at * 1000) as createdAt FROM files WHERE id = ?",
      )
      .get(id) as FileMetadata | undefined;
    if (!file) {
      logger.warn(`File not found: ${id}`);
      return apiResponse.error(c, "File not found", 404);
    }

    const chunks = db.prepare("SELECT * FROM chunks WHERE file_id = ? ORDER BY idx ASC").all(id) as ChunkMetadata[];

    return apiResponse.success<FileMetadata & { chunks: ChunkMetadata[] }>(c, {
      ...file,
      chunks,
    });
  } catch (error: unknown) {
    logger.error(`Failed to fetch file details for ${id}:`, error);
    return apiResponse.error(c, "Failed to fetch file details", 500);
  }
});

/**
 * Restore file from Trash
 */
files.post("/:id/restore", async (c) => {
  const id = c.req.param("id");
  try {
    const file = db.prepare("SELECT status FROM files WHERE id = ?").get(id) as { status: string } | undefined;
    if (!file) return apiResponse.error(c, "File not found", 404);

    if (file.status !== "trashed") {
      return apiResponse.error(c, "File is not in trash", 400);
    }

    db.run("UPDATE files SET status = 'active' WHERE id = ?", [id]);
    logger.info(`Restored file ${id} from trash`);

    backupDatabase().catch((err: unknown) => {
      logger.error("Background backup failed after restoration:", err);
    });

    return apiResponse.success(c, { message: "File restored" });
  } catch (error: unknown) {
    logger.error(`Failed to restore file ${id}:`, error);
    return apiResponse.error(c, "Failed to restore file", 500);
  }
});

/**
 * Empty Trash (Hard Delete all trashed files)
 */
files.delete("/trash", async (c) => {
  try {
    const trashedFiles = db.prepare("SELECT id FROM files WHERE status = 'trashed'").all() as { id: string }[];

    if (trashedFiles.length === 0) {
      return apiResponse.success(c, { message: "Trash is already empty", deletedCount: 0 });
    }

    const ids = trashedFiles.map((f) => f.id);
    const placeholders = ids.map(() => "?").join(",");

    // Get all chunks for these files
    const chunks = db.prepare(`SELECT message_id FROM chunks WHERE file_id IN (${placeholders})`).all(...ids) as {
      message_id: string;
    }[];
    const messageIds = chunks.map((c) => c.message_id);

    // Delete files and chunks from DB
    db.run(`DELETE FROM files WHERE id IN (${placeholders})`, ids);
    db.run(`DELETE FROM chunks WHERE file_id IN (${placeholders})`, ids);

    logger.info(`Emptied trash: Deleted ${ids.length} files and cleaning up ${messageIds.length} chunks`);

    // Async cleanup on Discord
    bulkDeleteFromDiscord(messageIds).catch((err: unknown) => {
      logger.error("Background Discord cleanup failed for empty trash:", err);
    });

    backupDatabase().catch((err: unknown) => {
      logger.error("Background backup failed after empty trash:", err);
    });

    return apiResponse.success(c, { message: "Trash emptied", deletedCount: ids.length });
  } catch (error: unknown) {
    logger.error("Failed to empty trash:", error);
    return apiResponse.error(c, "Failed to empty trash", 500);
  }
});

/**
 * Delete file (Soft Delete -> Hard Delete)
 */
files.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const file = db.prepare("SELECT status, name FROM files WHERE id = ?").get(id) as
      | { status: string; name: string }
      | undefined;
    if (!file) return apiResponse.error(c, "File not found", 404);

    // 1. Soft Delete: Active -> Trashed
    if (file.status === "active") {
      db.run("UPDATE files SET status = 'trashed' WHERE id = ?", [id]);
      logger.info(`Soft deleted (trashed) file ${id}`);

      backupDatabase().catch((err: unknown) => {
        logger.error("Background backup failed after trashing:", err);
      });

      return apiResponse.success(c, { message: "File moved to trash" });
    }

    // 2. Hard Delete: Trashed -> Permanent
    logger.info(`Permanently deleting file ${id}`);

    const chunks = db.prepare("SELECT message_id FROM chunks WHERE file_id = ?").all(id) as { message_id: string }[];
    const messageIds = chunks.map((c) => c.message_id);

    db.run("DELETE FROM files WHERE id = ?", [id]);
    logger.debug(`Deleted metadata for ${id}, cleaning up ${messageIds.length} chunks on Discord`);

    bulkDeleteFromDiscord(messageIds).catch((err: unknown) => {
      logger.error(`Background Discord cleanup failed for ${id}:`, err);
    });

    backupDatabase().catch((err: unknown) => {
      logger.error("Background backup failed after deletion:", err);
    });

    return apiResponse.success(c, { message: "File permanently deleted" });
  } catch (error: unknown) {
    logger.error(`Failed to delete file ${id}:`, error);
    return apiResponse.error(c, "Failed to delete file", 500);
  }
});

export default files;

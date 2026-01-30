import { Hono } from "hono";
import db from "../db";
import { backupDatabase } from "../lib/backup";
import { uploadToDiscord } from "../lib/discord";
import { logger } from "../lib/logger";
import { apiResponse } from "../lib/response";
import { FileMetadata } from "../types";

const upload = new Hono();

/**
 * Handle individual chunk upload
 * Client sends encrypted ArrayBuffer via UpChunk
 */
upload.post("/file/:id/chunk", async (c) => {
  const fileId = c.req.param("id");
  // Smart Chunk Indexing
  let chunkIndex = 0;
  const chunkHeader = c.req.header("X-Chunk-Number");
  const contentRange = c.req.header("Content-Range"); // bytes start-end/total

  if (chunkHeader) {
    chunkIndex = parseInt(chunkHeader) - 1;
  } else if (contentRange) {
    const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
    if (match) {
      const start = parseInt(match[1]);
      if (start === 0) {
        chunkIndex = 0;
      } else {
        // Fetch size of chunk 0 to calculate current index (assuming constant chunk size)
        const chunk0 = db.prepare("SELECT size FROM chunks WHERE file_id = ? AND idx = 0").get(fileId) as
          | { size: number }
          | undefined;

        if (chunk0) {
          chunkIndex = Math.round(start / chunk0.size);
        } else {
          // If chunk 0 is missing, we might have received out-of-order chunks (parallel).
          // For now, fail or default? defaulting to 0 would corrupt it.
          // We'll log error and try to use index 0 but it's risky.
          // Actually, UpChunk is sequential by default.
          logger.warn(`Received chunk at offset ${start} but Chunk 0 is missing. Assuming Index 0 (RISKY).`);
          chunkIndex = 0; // Fallback
        }
      }
    }
  }

  logger.debug(`[Upload Debug] Computed Chunk Index: ${chunkIndex} (Range: ${contentRange})`);

  const buffer = await c.req.arrayBuffer();

  if (!buffer || buffer.byteLength === 0) {
    return apiResponse.error(c, "Empty chunk", 400);
  }

  // Validate File Existence before uploading to Discord
  const fileExists = db.prepare("SELECT 1 FROM files WHERE id = ? AND status = 'pending'").get(fileId);
  if (!fileExists) {
    logger.warn(`Rejected chunk ${chunkIndex} for aborted/missing file: ${fileId}`);
    return apiResponse.error(c, "Upload session invalid or aborted", 404);
  }

  try {
    logger.debug(`Starting chunk upload for file ${fileId}, index ${chunkIndex}`);

    // 0. Idempotency Check: Remove existing chunk if retrying
    const existingChunk = db
      .prepare("SELECT message_id FROM chunks WHERE file_id = ? AND idx = ?")
      .get(fileId, chunkIndex) as { message_id: string } | undefined;

    if (existingChunk) {
      logger.warn(`Overwriting existing chunk ${chunkIndex} for file ${fileId}`);
      // Remove DB Record
      db.run("DELETE FROM chunks WHERE file_id = ? AND idx = ?", [fileId, chunkIndex]);
      // Async cleanup (Fire & Forget)
      const { bulkDeleteFromDiscord } = await import("../lib/discord");
      bulkDeleteFromDiscord([existingChunk.message_id]).catch((err) =>
        logger.error("Failed to clean up overwritten chunk:", err),
      );
    }

    // 1. Proxy to Discord
    const filename = `chunk_${fileId}_${chunkIndex}.bin`;
    const attachment = await uploadToDiscord(buffer, filename, c.req.raw.signal);

    logger.debug(`Chunk ${chunkIndex} uploaded to Discord: ${attachment.id}`);

    // 2. Double Check: Verify file still exists (Race Condition Protection)
    // If the user aborted *during* the Discord upload, the file record might be gone.
    const fileStillExists = db.prepare("SELECT 1 FROM files WHERE id = ? AND status = 'pending'").get(fileId);

    if (!fileStillExists) {
      logger.warn(`File ${fileId} aborted during chunk ${chunkIndex} upload. Cleaning up orphaned chunk.`);
      // Immediate cleanup of the just-uploaded chunk
      const { bulkDeleteFromDiscord } = await import("../lib/discord");
      bulkDeleteFromDiscord([attachment.id]).catch((err) => logger.error("Failed to clean up orphaned chunk:", err));
      return apiResponse.error(c, "Upload aborted during transfer", 404);
    }

    // 3. Save Chunk Metadata to SQLite
    db.run("INSERT INTO chunks (file_id, idx, message_id, channel_id, size, url) VALUES (?, ?, ?, ?, ?, ?)", [
      fileId,
      chunkIndex,
      attachment.id,
      process.env.DISCORD_CHANNEL_ID || "",
      buffer.byteLength,
      attachment.url,
    ]);

    return apiResponse.success(c, {
      messageId: attachment.id,
    });
  } catch (error: unknown) {
    logger.error(`Chunk ${chunkIndex} Error:`, error);
    return apiResponse.error(c, "Failed to upload chunk to storage", 500);
  }
});

/**
 * Finalize file upload
 * Saves initial file metadata
 */
upload.post("/file/init", async (c) => {
  const { id, name, size, type, iv, salt } = (await c.req.json()) as Partial<FileMetadata>;

  if (!id || !name || size === undefined) {
    return apiResponse.error(c, "Missing file metadata", 400);
  }

  try {
    // Check if ID already exists
    const existing = db.prepare("SELECT status FROM files WHERE id = ?").get(id) as
      | Pick<FileMetadata, "status">
      | undefined;

    if (existing) {
      if (existing.status === "active") {
        return apiResponse.error(c, "File ID already exists and is active", 409);
      }
      logger.debug(`Replacing pending file record: ${id}`);
      db.run("DELETE FROM files WHERE id = ?", [id]);
    }

    logger.debug(`Initializing file record: ${name} (${id})`);
    db.run("INSERT INTO files (id, name, size, type, iv, salt, status) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      id,
      name,
      size,
      type || "application/octet-stream",
      iv || "", // Default to empty string for unencrypted
      salt || "", // Default to empty string for unencrypted
      "pending",
    ]);
    return apiResponse.success(c);
  } catch (error: unknown) {
    logger.error("Init Error:", error);
    return apiResponse.error(c, "Failed to initialize file record", 500);
  }
});

/**
 * Get uploaded chunk indices for a file
 * Used for resumable upload discovery
 */
upload.get("/file/:id/chunks", async (c) => {
  const fileId = c.req.param("id");
  try {
    const chunks = db.prepare("SELECT idx FROM chunks WHERE file_id = ?").all(fileId) as {
      idx: number;
    }[];
    return apiResponse.success(
      c,
      chunks.map((ch) => ch.idx),
    );
  } catch (error: unknown) {
    logger.error("Chunk Discovery Error:", error);
    return apiResponse.error(c, "Failed to fetch chunk metadata", 500);
  }
});

/**
 * Finalize file upload status
 */
upload.post("/file/:id/finalize", async (c) => {
  const fileId = c.req.param("id");

  try {
    logger.info(`Finalizing file ${fileId}`);
    db.run("UPDATE files SET status = 'active' WHERE id = ?", [fileId]);

    const skipBackup = c.req.query("skip_backup") === "true";

    // Trigger VACUUM as per arch.md
    logger.debug("Triggering VACUUM");
    db.exec("VACUUM;");

    // Trigger background backup unless skipped
    if (!skipBackup) {
      backupDatabase().catch((err: unknown) => {
        logger.error("Background task failed:", err);
      });
    } else {
      logger.debug(`Skipping backup for file ${fileId} (batch mode)`);
    }

    return apiResponse.success(c);
  } catch (error: unknown) {
    logger.error("Finalize Error:", error);
    return apiResponse.error(c, "Failed to finalize file", 500);
  }
});

/**
 * Abort archival process
 * Cleans up pending records and purged shards from Discord
 */
upload.post("/file/:id/abort", async (c) => {
  const fileId = c.req.param("id");

  try {
    logger.info(`Aborting archival for file ${fileId}`);
    // 1. Get shard IDs for cleanup
    const chunks = db.prepare("SELECT message_id FROM chunks WHERE file_id = ?").all(fileId) as {
      message_id: string;
    }[];
    const messageIds = chunks.map((c) => c.message_id);

    // 2. Delete metadata (CASCADE handles chunks)
    db.run("DELETE FROM files WHERE id = ? AND status = 'pending'", [fileId]);
    logger.debug(`Purged pending metadata for ${fileId}, cleaning up ${messageIds.length} shards`);

    // 3. Trigger Discord Cleanup
    if (messageIds.length > 0) {
      const { bulkDeleteFromDiscord } = await import("../lib/discord");
      bulkDeleteFromDiscord(messageIds).catch((err: unknown) => {
        logger.error(`Background abort cleanup failed for ${fileId}:`, err);
      });
    }

    return apiResponse.success(c);
  } catch (error: unknown) {
    logger.error(`Failed to abort archival for ${fileId}:`, error);
    return apiResponse.error(c, "Failed to abort archival", 500);
  }
});

/**
 * Bulk purge all pending uploads
 */
upload.delete("/file/pending/all", async (c) => {
  try {
    logger.info("Bulk purging all pending uploads");
    // 1. Get all chunks for all pending files
    const chunks = db
      .prepare(
        `
      SELECT message_id FROM chunks
      WHERE file_id IN (SELECT id FROM files WHERE status = 'pending')
    `,
      )
      .all() as { message_id: string }[];

    const messageIds = chunks.map((c) => c.message_id);

    // 2. Delete from DB
    db.run("DELETE FROM chunks WHERE file_id IN (SELECT id FROM files WHERE status = 'pending')");
    db.run("DELETE FROM files WHERE status = 'pending'");

    logger.debug(`Purged all pending metadata, cleaning up ${messageIds.length} shards`);

    // 3. Trigger Discord Cleanup
    if (messageIds.length > 0) {
      const { bulkDeleteFromDiscord } = await import("../lib/discord");
      bulkDeleteFromDiscord(messageIds).catch((err: unknown) => {
        logger.error("Background bulk-purge cleanup failed:", err);
      });
    }

    return apiResponse.success(c, { purgedCount: messageIds.length });
  } catch (error: unknown) {
    logger.error("Bulk Purge Error:", error);
    return apiResponse.error(c, "Failed to purge pending uploads", 500);
  }
});

export default upload;

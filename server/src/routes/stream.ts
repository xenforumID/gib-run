import { Hono } from "hono";
import db from "../db";
import { getDiscordCDNUrl, refreshDiscordUrls } from "../lib/discord";
import { logger } from "../lib/logger";
import { ChunkMetadata, FileMetadata } from "../types";

const stream = new Hono();

/**
 * Stream File (Range Request Proxy)
 * Maps global byte range -> Chunk Index -> Local Range
 */
stream.get("/file/:id", async (c) => {
  const fileId = c.req.param("id");
  const rangeHeader = c.req.header("Range");

  try {
    // 1. Get File Metadata (Total Size)
    const file = db.prepare("SELECT size, name, type FROM files WHERE id = ?").get(fileId) as FileMetadata | undefined;

    if (!file) return c.text("File not found", 404);

    // 2. Parse Range (Default to 0-)
    let start = 0;
    let end = file.size - 1;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      if (parts[1]) {
        end = parseInt(parts[1], 10);
      }
    }

    // 3. Identify Target Chunk
    // We need to find which chunk contains the 'start' byte.
    // Since chunks might vary in size (though usually 8MB), we should query the DB to find the specific chunk.
    // However, for efficiency, most chunks are standard size. But the LAST chunk is smaller.
    // Robust way: Sum sizes until we reach start? No, that's slow.
    // Robust way: We can assume sequential indexing.
    // Actually, we can just query: "Get chunk where cumulative previous size <= start"
    // But we don't store cumulative size.

    // FAST APPROXIMATION (Assuming fixed size regular chunks)
    // We'll rely on our fixed chunk size (8MB = 8192 * 1024 = 8388608 bytes)
    // Note: User just updated to 8MB. Old files might be 5MB. Mixed environment!
    // We CANNOT assume fixed size. We must query.

    // Correct Approach:
    // SELECT * FROM chunks WHERE file_id = ? ORDER BY idx ASC
    // Iterate to find the container. (Cached in memory would be better, but SQLite is fast enough for now).

    const chunks = db
      .prepare("SELECT idx, size, url, message_id FROM chunks WHERE file_id = ? ORDER BY idx ASC")
      .all(fileId) as ChunkMetadata[];

    let currentOffset = 0;
    let targetChunk: ChunkMetadata | null = null;
    let chunkStartOffset = 0;

    for (const chunk of chunks) {
      if (start >= currentOffset && start < currentOffset + chunk.size) {
        targetChunk = chunk;
        chunkStartOffset = currentOffset;
        break;
      }
      currentOffset += chunk.size;
    }

    if (!targetChunk) {
      return c.text("Range Not Satisfiable", 416);
    }

    // 4. Calculate Local Range within Chunk
    const localStart = start - chunkStartOffset;
    const localAvailable = targetChunk.size - localStart;

    // Clamp request end to the end of THIS chunk.
    // The browser will ask for the next part in a subsequent request.
    const requestSize = end - start + 1;
    const actualLength = Math.min(requestSize, localAvailable);
    const localEnd = localStart + actualLength - 1;
    const globalEnd = start + actualLength - 1;

    // 5. Ensure URL is fresh
    let cdnUrl = targetChunk.url;
    const isExpired = (url?: string) => {
      if (!url) return true;
      try {
        const u = new URL(url);
        const ex = u.searchParams.get("ex");
        if (!ex) return true;
        // Refresh if less than 5 mins left
        return parseInt(ex, 16) < Math.floor(Date.now() / 1000) + 300;
      } catch {
        return true;
      }
    };

    if (isExpired(cdnUrl) && targetChunk.message_id) {
      logger.debug(`Refreshing URL for streaming ${fileId} chunk ${targetChunk.idx}`);
      try {
        // 1. Try Bulk Refresh
        if (cdnUrl) {
          try {
            const refreshed = await refreshDiscordUrls([cdnUrl]);
            if (refreshed[0]) cdnUrl = refreshed[0];
          } catch (e) {
            /* fallback to JIT */
          }
        }

        // 2. JIT Refresh (Primary Channel)
        if (!cdnUrl || isExpired(cdnUrl)) {
          cdnUrl = await getDiscordCDNUrl(targetChunk.message_id);
        }
        db.run("UPDATE chunks SET url = ? WHERE message_id = ?", [cdnUrl, targetChunk.message_id]);
      } catch (e) {
        logger.warn(
          `Stream refresh failed for ${fileId} chunk ${targetChunk.idx} on primary channel, trying backup...`,
        );
        try {
          // 3. JIT Refresh (Backup Channel)
          const BACKUP_CHANNEL = process.env.DISCORD_BACKUP_CHANNEL_ID;
          if (BACKUP_CHANNEL) {
            const originalChannel = process.env.DISCORD_CHANNEL_ID;
            process.env.DISCORD_CHANNEL_ID = BACKUP_CHANNEL;
            cdnUrl = await getDiscordCDNUrl(targetChunk.message_id);
            process.env.DISCORD_CHANNEL_ID = originalChannel;

            if (cdnUrl) {
              db.run("UPDATE chunks SET url = ? WHERE message_id = ?", [cdnUrl, targetChunk.message_id]);
              logger.info(`Successfully recovered chunk ${targetChunk.idx} from backup channel`);
            }
          }
        } catch (backupErr) {
          logger.error(
            `Stream refresh failed for ${fileId} chunk ${targetChunk.idx}:`,
            e instanceof Error ? e.message : e,
          );
        }
      }
    }

    // 6. Fetch from Discord
    logger.debug(
      `Streaming ${fileId}: Chunk ${targetChunk.idx} (Global ${start}-${globalEnd} -> Local ${localStart}-${localEnd})`,
    );

    const response = await fetch(cdnUrl!, {
      headers: {
        Range: `bytes=${localStart}-${localEnd}`,
      },
    });

    if (!response.ok && response.status !== 206) {
      logger.error(`Discord Fetch Failed: ${response.status}`);
      return c.text("Upstream Error", 502);
    }

    // 7. Pipe Response
    return new Response(response.body, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${globalEnd}/${file.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": actualLength.toString(),
        "Content-Type": file.type || "application/octet-stream",
      },
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(`[STREAM CRITICAL] Error for ${fileId}:`, error.message);
    return c.text("Internal Server Error", 500);
  }
});

export default stream;

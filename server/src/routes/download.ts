import { Hono } from "hono";
import db from "../db";
import { getDiscordCDNUrl, refreshDiscordUrls } from "../lib/discord";
import { logger } from "../lib/logger";
import { ChunkMetadata, FileMetadata } from "../types";

const download = new Hono();

/**
 * GET /:id
 * Direct Download (Raw Proxy for Client-Side Decryption)
 * Serves the exact encrypted bytes from Discord.
 */
download.get("/:id", async (c) => {
  const fileId = c.req.param("id");

  try {
    // 1. Get Metadata
    const file = db.prepare("SELECT id, name, size, type FROM files WHERE id = ?").get(fileId) as
      | FileMetadata
      | undefined;
    if (!file) return c.text("File not found", 404);

    const chunks = db
      .prepare("SELECT idx, size, url, message_id FROM chunks WHERE file_id = ? ORDER BY idx ASC")
      .all(fileId) as ChunkMetadata[];

    if (chunks.length === 0) return c.text("File has no chunks", 404);

    // 2. Handle Individual Chunk Request (Parallel Optimization)
    // Kept index query support but restored the simple JIT logic inside
    const chunkIndexStr = c.req.query("index");
    if (chunkIndexStr !== undefined) {
      const idx = parseInt(chunkIndexStr, 10);
      const chunk = chunks.find((ch) => ch.idx === idx);
      if (!chunk) return c.text("Chunk not found", 404);

      let cdnUrl = chunk.url;
      if (
        !cdnUrl ||
        (cdnUrl.includes("ex=") && parseInt(new URL(cdnUrl).searchParams.get("ex") || "0", 16) < Date.now() / 1000)
      ) {
        try {
          // 1. Bulk Refresh Attempt
          const refreshed = await refreshDiscordUrls([cdnUrl!]);
          if (refreshed[0]) {
            cdnUrl = refreshed[0];
          } else if (chunk.message_id) {
            // 2. JIT Fallback
            cdnUrl = await getDiscordCDNUrl(chunk.message_id);
          }

          if (cdnUrl) {
            db.run("UPDATE chunks SET url = ? WHERE message_id = ?", [cdnUrl, chunk.message_id]);
          }
        } catch (e) {
          logger.error(`Failed to refresh URL for chunk ${idx}:`, e instanceof Error ? e.message : e);
        }
      }

      const response = await fetch(cdnUrl!, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) return c.text(`Discord fetch failed: ${response.status}`, 502);

      return new Response(response.body, {
        headers: {
          "Content-Length": chunk.size.toString(),
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // 3. Full Stream Logic (Restored to simple body pipe)
    const totalEncryptedSize = chunks.reduce((acc, ch) => acc + ch.size, 0);
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    (async () => {
      try {
        const fetchChunkData = async (chunk: ChunkMetadata) => {
          if (c.req.raw.signal.aborted) throw new Error("Client aborted");

          let cdnUrl = chunk.url;
          let attempt = 0;
          const MAX_ATTEMPTS = 2; // Initial + 1 Retry

          while (attempt < MAX_ATTEMPTS) {
            attempt++;

            // Check expiry strictly on first attempt, or Force Refresh on Retry
            const isRetry = attempt > 1;
            const isExpired =
              !cdnUrl ||
              (cdnUrl.includes("ex=") &&
                parseInt(new URL(cdnUrl).searchParams.get("ex") || "0", 16) < Date.now() / 1000);

            if (isExpired || (isRetry && chunk.message_id)) {
              try {
                // If retrying, force refresh even if "ex" looks valid (CDN might be flaky)
                if (isRetry) logger.debug(`[UPSTREAM RETRY] Refreshing URL for chunk ${chunk.idx}`);

                const refreshed = await refreshDiscordUrls([cdnUrl!]);
                if (refreshed[0]) {
                  cdnUrl = refreshed[0];
                } else if (chunk.message_id) {
                  cdnUrl = await getDiscordCDNUrl(chunk.message_id);
                }

                if (cdnUrl) {
                  db.run("UPDATE chunks SET url = ? WHERE message_id = ?", [cdnUrl, chunk.message_id]);
                }
              } catch (e) {
                logger.debug(`Stream JIT refresh warning for chunk ${chunk.idx}:`, e instanceof Error ? e.message : e);
              }
            }

            try {
              if (c.req.raw.signal.aborted) throw new Error("Client aborted");

              logger.debug(`[UPSTREAM START] Chunk ${chunk.idx + 1}/${chunks.length} (Attempt ${attempt})`);
              const response = await fetch(cdnUrl!, { signal: AbortSignal.timeout(120000) }); // Increased to 120s for slow connections

              if (!response.ok) {
                if (response.status === 403 || response.status === 410) {
                  // Auth expired, definitely retry
                  if (attempt < MAX_ATTEMPTS) continue;
                }
                throw new Error(`Fetch failed: ${response.status}`);
              }

              const buffer = await response.arrayBuffer();
              logger.debug(`[UPSTREAM DONE] Chunk ${chunk.idx + 1}/${chunks.length}`);
              return buffer;
            } catch (err: any) {
              // If client aborted, stop immediately
              if (c.req.raw.signal.aborted || err.message === "Client aborted") throw err;

              // If it's a timeout or network error, retry if possible
              if (attempt < MAX_ATTEMPTS) {
                logger.warn(
                  `[UPSTREAM ERROR] Chunk ${chunk.idx} failed (Attempt ${attempt}): ${err.message}. Retrying...`,
                );
                await new Promise((r) => setTimeout(r, 1000)); // Backoff
                continue;
              }
              throw err;
            }
          }
          throw new Error("Unreachable");
        };

        // Resumable Streaming: Support start_chunk parameter
        const startChunkIndex = parseInt(c.req.query("start_chunk") || "0", 10);
        const filteredChunks = chunks.filter((ch) => ch.idx >= startChunkIndex);

        // Scalability: Sliding Window of 2 Chunks (Reduced from 3 to prevent stalls on slow connections)
        const WINDOW_SIZE = 2;
        const chunkPromises: Array<Promise<ArrayBuffer> | null> = new Array(filteredChunks.length).fill(null);

        // Initialize first WINDOW_SIZE chunks
        for (let i = 0; i < Math.min(WINDOW_SIZE, filteredChunks.length); i++) {
          chunkPromises[i] = fetchChunkData(filteredChunks[i]);
        }

        for (let i = 0; i < filteredChunks.length; i++) {
          if (c.req.raw.signal.aborted) throw new Error("Client aborted");

          // 1. Wait for current chunk
          const currentData = await chunkPromises[i];
          if (!currentData) throw new Error(`Chunk ${filteredChunks[i].idx} data missing`);

          // 2. Clear reference to free memory immediately
          chunkPromises[i] = null;

          // 3. Start fetching the Look-Ahead chunk (Window Shift)
          const lookAheadIndex = i + WINDOW_SIZE;
          if (lookAheadIndex < filteredChunks.length) {
            chunkPromises[lookAheadIndex] = fetchChunkData(filteredChunks[lookAheadIndex]);
          }

          // 4. Write to stream
          if (c.req.raw.signal.aborted) throw new Error("Client aborted");
          await writer.write(new Uint8Array(currentData));
        }

        await writer.close();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : typeof err === "object" ? JSON.stringify(err) : String(err);

        if (errorMessage === "Client aborted") {
          logger.info(`[STREAM ABORT] File ${fileId} cancelled by client`);
        } else if (errorMessage !== "undefined") {
          logger.error(`[STREAM CRITICAL] File ${fileId} failed:`, errorMessage);
        }
        writer.abort(err).catch(() => {});
      }
    })();

    const disposition = c.req.query("inline") === "true" ? "inline" : "attachment";

    // Encode filename for modern browsers (RFC 5987)
    // Legacy clients get a sanitized ASCII-ish version (or just raw chars which might break)
    // Modern clients use filename*=UTF-8''
    const encodedFilename = encodeURIComponent(file.name);

    return new Response(readable, {
      headers: {
        "Content-Length": totalEncryptedSize.toString(),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedFilename}`,
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    logger.error("Download Error", error);
    return c.text("Internal Server Error", 500);
  }
});

export default download;

import { type ChunkMetadata, type FileMetadata } from "../types";
import { api } from "./api";

// Configuration
const CONCURRENCY = 3;
const CHUNK_SIZE = 8192 * 1024; // 8MB

interface ProcessOptions {
  onProgress?: (
    progress: number,
    speed: number,
    eta: number,
    uploadedChunks?: number,
    totalChunks?: number,
    totalUploaded?: number,
  ) => void;
  signal?: AbortSignal;
}

interface DownloadOptions extends ProcessOptions {
  fileId: string;
  name: string;
  mode: "download" | "preview";
  initialBlobs?: Blob[];
  onChunkDownloaded?: (index: number, chunk: Blob) => void;
}

interface UploadOptions extends ProcessOptions {
  file: File;
  shouldEncrypt: boolean;
  isLast: boolean;
}

// Helper: Async Pool for Concurrency
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<T[]> {
  if (signal?.aborted) throw new Error("Aborted");

  return new Promise((resolve, reject) => {
    const results: T[] = new Array(tasks.length);
    let currentIndex = 0;
    let running = 0;
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      reject(new Error("Aborted"));
    };

    signal?.addEventListener("abort", onAbort);

    const runNext = async () => {
      if (aborted || currentIndex >= tasks.length) return;

      const index = currentIndex++;
      running++;

      try {
        results[index] = await tasks[index]();
        running--;
        if (!aborted) {
          if (currentIndex < tasks.length) {
            runNext();
          } else if (running === 0) {
            signal?.removeEventListener("abort", onAbort);
            resolve(results);
          }
        }
      } catch (err) {
        if (!aborted) {
          aborted = true;
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        }
      }
    };

    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
      runNext();
    }
  });
}

// --- Worker Management ---

function createWorker() {
  return new Worker(new URL("../workers/processor.worker.ts", import.meta.url), {
    type: "module",
  });
}

function initWorker(worker: Worker, masterKey: string, salt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "INIT_READY") {
        worker.removeEventListener("message", handler);
        resolve();
      } else if (e.data.type === "ERROR") {
        worker.removeEventListener("message", handler);
        reject(new Error(e.data.payload));
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ type: "INIT", payload: { password: masterKey, salt } });
  });
}

// --- Download Logic ---

export async function processDownload({
  fileId,
  onProgress,
  signal,
  initialBlobs = [],
  onChunkDownloaded,
}: DownloadOptions): Promise<string> {
  const worker = createWorker();

  try {
    const API_URL = import.meta.env.VITE_API_URL;
    const API_SECRET = import.meta.env.VITE_API_SECRET || "";

    // 1. Fetch Metadata
    const responseMetadata = await api.get<FileMetadata & { chunks: ChunkMetadata[] }>(`/files/${fileId}`);
    if (!responseMetadata) throw new Error("File metadata not found");

    const { chunks, salt, iv: fileIv } = responseMetadata;

    // 2. Detect Encryption
    const isHex = (str: string) => /^[0-9a-fA-F]{24,64}$/.test(str);
    const isAllZeros = (str: string) => /^0+$/.test(str);
    const isEncrypted = salt && isHex(salt) && !isAllZeros(salt) && fileIv && isHex(fileIv) && !isAllZeros(fileIv);

    // 3. Bypass for Unencrypted (Standard) Mode
    if (!isEncrypted) {
      worker.terminate();
      return `${API_URL}/stream/file/${fileId}?token=${API_SECRET}`;
    }

    // Check for Init Worker if Encrypted
    const MASTER_KEY = import.meta.env.VITE_MASTER_KEY;
    if (!MASTER_KEY) throw new Error("Missing Master Key");
    await initWorker(worker, MASTER_KEY, salt);

    const totalBytes = responseMetadata.size || chunks.reduce((acc, c) => acc + c.size, 0);
    let downloadedBytes = initialBlobs.reduce((acc, b) => acc + (b?.size || 0), 0);
    let sessionBytes = 0;
    const sessionStartTime = Date.now();
    let lastUpdate = 0;

    // 4. Chunk Task Creator
    const createChunkTask = (_chunk: ChunkMetadata, index: number) => async (): Promise<Blob> => {
      if (initialBlobs[index]) return initialBlobs[index];
      if (signal?.aborted) throw new Error("Aborted");

      let retries = 0;
      while (retries < 3) {
        try {
          const streamUrl = `${API_URL}/download/${fileId}?token=${API_SECRET}&index=${index}`;
          const res = await fetch(streamUrl, { signal });
          if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

          if (!res.body) throw new Error("No response body");
          const reader = res.body.getReader();
          let parsedBytes = 0;
          const chunksArr: Uint8Array[] = [];

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              if (value) {
                chunksArr.push(value);
                parsedBytes += value.length;
                downloadedBytes += value.length;
                sessionBytes += value.length;

                const now = Date.now();
                if (now - lastUpdate > 200 && onProgress) {
                  const elapsed = (now - sessionStartTime) / 1000;
                  const speed = elapsed > 0 ? sessionBytes / elapsed : 0;
                  const prog = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
                  const remaining = totalBytes - downloadedBytes;
                  const eta = speed > 0 ? remaining / speed : 0;
                  onProgress(prog, speed, eta);
                  lastUpdate = now;
                }
              }
            }
          } catch (err) {
            downloadedBytes -= parsedBytes;
            throw err;
          }

          const arrayBuffer = new Uint8Array(chunksArr.reduce((a, b) => a + b.length, 0));
          let offset = 0;
          for (const c of chunksArr) {
            arrayBuffer.set(c, offset);
            offset += c.length;
          }

          let finalBuffer = arrayBuffer.buffer;

          // Decrypt
          worker.postMessage({ type: "DECRYPT_CHUNK", payload: { chunk: finalBuffer, index, iv: fileIv } }, [
            finalBuffer,
          ]);
          finalBuffer = await new Promise((resolve, reject) => {
            const h = (e: MessageEvent) => {
              if (e.data.type === "CHUNK_DECRYPTED" && e.data.payload.index === index) {
                worker.removeEventListener("message", h);
                resolve(e.data.payload.chunk);
              } else if (e.data.type === "ERROR") {
                worker.removeEventListener("message", h);
                reject(new Error(e.data.payload));
              }
            };
            worker.addEventListener("message", h);
          });

          const finalBlob = new Blob([finalBuffer]);
          onChunkDownloaded?.(index, finalBlob);
          return finalBlob;
        } catch (e: unknown) {
          retries++;
          if (signal?.aborted) throw new Error("Aborted");
          if (retries >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * retries));
        }
      }
      throw new Error("Failed to download chunk");
    };

    const tasks = chunks.map((c, i) => createChunkTask(c, i));
    const blobs = await runWithConcurrency(tasks, CONCURRENCY, signal);

    const finalBlob = new Blob(blobs, { type: responseMetadata.type || "application/octet-stream" });
    return window.URL.createObjectURL(finalBlob);
  } finally {
    worker.terminate();
  }
}

// --- Upload Logic ---

export async function processUpload({ file, shouldEncrypt, isLast, onProgress, signal }: UploadOptions): Promise<void> {
  // Hoist variables for catch/finally scope
  const API_URL = import.meta.env.VITE_API_URL;
  const API_SECRET = import.meta.env.VITE_API_SECRET || "";
  let fileId = "";
  let worker: Worker | null = null; // Declare worker here for finally block access

  try {
    worker = createWorker(); // Initialize worker inside try block
    const MASTER_KEY = import.meta.env.VITE_MASTER_KEY;
    if (shouldEncrypt && !MASTER_KEY) throw new Error("Missing Master Key");

    // Use a stable ID for the file per session to allow resumption
    // We'll generate it based on file name, size, and last modified date for stability
    const encoder = new TextEncoder();
    const data = encoder.encode(`${file.name}-${file.size}-${file.lastModified}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    fileId = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);

    // fetch(`${API_URL}/upload/file/${fileId}/abort`, { method: "POST", headers: { Authorization: API_SECRET }, keepalive: true });

    // 1. Crypto Init
    let iv = "";
    let salt = "";
    if (shouldEncrypt) {
      const g = (n: number) => {
        const a = new Uint8Array(n);
        crypto.getRandomValues(a);
        return Array.from(a)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      };
      iv = g(16);
      salt = g(32);
      await initWorker(worker, MASTER_KEY!, salt);
    }

    // 2. Init/Check on Server
    await api.post("/upload/file/init", {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      iv: shouldEncrypt ? iv : null,
      salt: shouldEncrypt ? salt : null,
    });

    // 3. Discovery: What do we have?
    let existingChunks: number[] = [];
    try {
      const res = await api.get<number[]>(`/upload/file/${fileId}/chunks`);
      if (res) existingChunks = res;
    } catch {
      /* ignore */
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const chunkProgress = new Float64Array(totalChunks);
    let finishedChunks = existingChunks.length;

    for (const idx of existingChunks) chunkProgress[idx] = CHUNK_SIZE;

    const sessionStartTime = Date.now();
    let lastUpdate = 0;

    const createUploadTask = (index: number) => async (): Promise<void> => {
      if (existingChunks.includes(index)) return;
      if (signal?.aborted) throw new Error("Aborted");

      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);
      const ab = await blob.arrayBuffer();

      let payload = ab;
      if (shouldEncrypt) {
        worker!.postMessage({ type: "ENCRYPT_CHUNK", payload: { chunk: ab, index, iv } }, [ab]);
        payload = await new Promise((resolve, reject) => {
          const h = (e: MessageEvent) => {
            if (e.data.type === "CHUNK_ENCRYPTED" && e.data.payload.index === index) {
              worker!.removeEventListener("message", h);
              resolve(e.data.payload.chunk);
            } else if (e.data.type === "ERROR") {
              worker!.removeEventListener("message", h);
              reject(new Error(e.data.payload));
            }
          };
          worker!.addEventListener("message", h);
        });
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/upload/file/${fileId}/chunk`);
        xhr.setRequestHeader("Authorization", API_SECRET);
        xhr.setRequestHeader("X-Chunk-Number", (index + 1).toString());

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            chunkProgress[index] = e.loaded;
            const totalUploaded = chunkProgress.reduce((a, b) => a + b, 0);
            const now = Date.now();
            if (now - lastUpdate > 200) {
              const sendProg = totalUploaded / file.size;
              const confirmProg = finishedChunks / totalChunks;
              const prog = Math.min(99, Math.round(sendProg * 30 + confirmProg * 70));
              const elapsed = (now - sessionStartTime) / 1000;
              const speed = elapsed > 0 ? totalUploaded / elapsed : 0;
              const remaining = file.size - totalUploaded;
              const eta = speed > 0 ? remaining / speed : 0;
              onProgress(prog, speed, eta, finishedChunks, totalChunks, totalUploaded);
              lastUpdate = now;
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            chunkProgress[index] = payload.byteLength;
            finishedChunks++;
            resolve();
          } else reject(new Error(`Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network Error"));
        xhr.onabort = () => reject(new Error("Aborted"));

        if (signal) signal.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(payload);
      });
    };

    const tasks = Array.from({ length: totalChunks }, (_, i) => createUploadTask(i));
    await runWithConcurrency(tasks, CONCURRENCY, signal);

    await api.post(`/upload/file/${fileId}/finalize?skip_backup=${!isLast}`, {});
  } catch (err) {
    if (signal?.aborted) throw new Error("Aborted");
    throw err;
  } finally {
    worker?.terminate();
  }
}

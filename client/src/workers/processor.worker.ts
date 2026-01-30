/**
 * Librarian File Processor (Web Worker)
 * Handles heavy lifting: encryption/decryption using AES-256-GCM.
 */

let cryptoKey: CryptoKey | null = null;

async function deriveKey(password: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await self.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
  return self.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === "INIT") {
      const { password, salt } = payload;
      const saltBuffer = new Uint8Array(salt.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
      cryptoKey = await deriveKey(password, saltBuffer);
      self.postMessage({ type: "INIT_READY" });
    }

    if (type === "DECRYPT_CHUNK") {
      if (!cryptoKey) throw new Error("Worker not initialized");
      const { chunk, index, iv } = payload;

      const ivBuffer = new Uint8Array(iv.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));

      const decrypted = await self.crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuffer }, cryptoKey, chunk);

      (self as unknown as Worker).postMessage(
        {
          type: "CHUNK_DECRYPTED",
          payload: { chunk: decrypted, index },
        },
        [decrypted] as Transferable[],
      );
    }

    if (type === "ENCRYPT_CHUNK") {
      if (!cryptoKey) throw new Error("Worker not initialized");
      const { chunk, index, iv } = payload;

      const ivBuffer = new Uint8Array(iv.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));

      const encrypted = await self.crypto.subtle.encrypt({ name: "AES-GCM", iv: ivBuffer }, cryptoKey, chunk);

      (self as unknown as Worker).postMessage(
        {
          type: "CHUNK_ENCRYPTED",
          payload: { chunk: encrypted, index },
        },
        [encrypted] as Transferable[],
      );
    }
  } catch (error: unknown) {
    (self as unknown as Worker).postMessage({ type: "ERROR", payload: (error as Error).message });
  }
};

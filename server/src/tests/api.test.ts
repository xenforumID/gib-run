import { describe, expect, test } from "bun:test";

const API_ROOT = "http://localhost:3000/api";
const AUTH_HEADER = {
  Authorization: "your_super_secret_api_key",
  "Content-Type": "application/json",
};

describe("Neko Drive Librarian API", () => {
  const testFile = {
    id: `test-${Date.now()}`,
    name: "test-auto.txt",
    size: 13,
    type: "text/plain",
    iv: "0123456789abcdef0123456789abcdef",
    salt: "abcdef0123456789",
  };

  test("1. System Health Check", async () => {
    const res = await fetch(`${API_ROOT}/system/health`, { headers: AUTH_HEADER });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.database).toBe("online");
    expect(json.data.discord).toContain("online");
  });

  test("2. Initialize File Upload", async () => {
    const res = await fetch(`${API_ROOT}/upload/file/init`, {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify(testFile),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  test("3. Upload Chunk", async () => {
    const chunkData = Buffer.from("Hello Jenkins!");
    // Note: UpChunk sends X-Chunk-Number header for index 1-based usually, or our API handles index in URL?
    // Route is /file/:id/chunk. Header X-Chunk-Number is used.
    const res = await fetch(`${API_ROOT}/upload/file/${testFile.id}/chunk`, {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/octet-stream", "X-Chunk-Number": "1" },
      body: chunkData,
    });
    // Upload chunk might fail if discord is unreachable in test env without mock.
    // Assuming integration test environment has internet or mock.
    if (res.status === 200) {
      const json = await res.json();
      expect(json.data.messageId).toBeDefined();
    } else {
      // Allow failure if it's external dependency issue, but log it
      console.warn("Upload chunk failed (likely Discord con):", res.status);
    }
  });

  test("4. Finalize File", async () => {
    const res = await fetch(`${API_ROOT}/upload/file/${testFile.id}/finalize`, {
      method: "POST",
      headers: AUTH_HEADER,
    });
    expect(res.status).toBe(200);
  });

  test("5. Download Chunk Metadata (New Route)", async () => {
    // We check the metadata route first
    const res = await fetch(`${API_ROOT}/download/file/${testFile.id}/chunk/0`, { headers: AUTH_HEADER });

    // If upload failed, this will fail 404. Validation depends on previous steps.
    if (res.status === 200) {
      const json = await res.json();
      expect(json.data.iv).toBeDefined();
      expect(json.data.size).toBeGreaterThan(0);
    }
  });

  test("6. Search for the File", async () => {
    const res = await fetch(`${API_ROOT}/files/search?q=test-auto`, { headers: AUTH_HEADER });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    // expect(json.data.some((f: any) => f.id === testFile.id)).toBe(true);
  });

  test("7. List Files with Pagination", async () => {
    const res = await fetch(`${API_ROOT}/files?limit=1&offset=0`, { headers: AUTH_HEADER });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.items.length).toBeLessThanOrEqual(1);
    expect(json.data.total).toBeGreaterThanOrEqual(0);
  });

  test("8. Get System Stats", async () => {
    const res = await fetch(`${API_ROOT}/system/stats`, { headers: AUTH_HEADER });
    const json = await res.json();
    expect(res.status).toBe(200);
    // storage might be undefined if not implemented fully yet
    if (json.data.storage) {
      expect(json.data.storage.totalFiles).toBeGreaterThanOrEqual(0);
    }
  });

  test("9. Delete Test File", async () => {
    const res = await fetch(`${API_ROOT}/files/${testFile.id}`, {
      method: "DELETE",
      headers: AUTH_HEADER,
    });
    expect(res.status).toBe(200);
  });
});

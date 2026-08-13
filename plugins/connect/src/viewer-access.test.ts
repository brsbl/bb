import { describe, expect, it } from "vitest";
import {
  CONNECT_VIEWER_ACCESS_TOKEN_KV_KEY,
  hasViewerAccessToken,
  readOrCreateViewerAccessToken,
} from "./viewer-access.js";

describe("viewer access token", () => {
  it("persists a private token and only accepts its exact value", async () => {
    const values = new Map<string, unknown>();
    const kv = {
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async set(key: string, value: unknown) {
        values.set(key, value);
      },
    };

    const token = await readOrCreateViewerAccessToken(kv);
    expect(token).toHaveLength(43);
    expect(values.get(CONNECT_VIEWER_ACCESS_TOKEN_KV_KEY)).toBe(token);
    expect(await readOrCreateViewerAccessToken(kv)).toBe(token);
    expect(hasViewerAccessToken(token, token)).toBe(true);
    expect(hasViewerAccessToken(token, "forged-viewer-token")).toBe(false);
  });
});

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PluginKvStorage } from "@bb/plugin-sdk";

/** Private to one enrolled BB install; never sent to a browser or persisted link. */
export const CONNECT_VIEWER_ACCESS_TOKEN_KV_KEY = "viewer-access-token";

function newViewerAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Keep a stable local secret so the tunnel can prove that the Connect Worker,
 * not a loopback caller, authenticated the current viewer.
 */
export async function readOrCreateViewerAccessToken(
  kv: Pick<PluginKvStorage, "get" | "set">,
): Promise<string> {
  const stored = await kv.get<unknown>(CONNECT_VIEWER_ACCESS_TOKEN_KV_KEY);
  if (typeof stored === "string" && stored.length >= 32) return stored;

  const token = newViewerAccessToken();
  await kv.set(CONNECT_VIEWER_ACCESS_TOKEN_KV_KEY, token);
  return token;
}

/** Constant-time check prevents a local caller from guessing the marker. */
export function hasViewerAccessToken(
  expected: string,
  presented: string,
): boolean {
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return (
    expectedBytes.length === presentedBytes.length &&
    timingSafeEqual(expectedBytes, presentedBytes)
  );
}

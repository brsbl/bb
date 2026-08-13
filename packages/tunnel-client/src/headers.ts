import {
  CONNECT_VIEWER_ACCESS_HEADER,
  type HeaderPair,
} from "@bb/tunnel-contract";

const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  CONNECT_VIEWER_ACCESS_HEADER,
]);

export interface LoopbackHeaderRewrite {
  publicOrigin: string;
  loopbackOrigin: string;
  /**
   * When set, inject a Host header (share streams). When omitted, Host is
   * dropped — bare-handle behavior, byte-identical to pre-share.
   */
  host?: string;
  /**
   * A per-install secret appended only to authenticated Connect requests for
   * BB's own origin. Share origins must never receive it.
   */
  connectViewerAccessToken?: string;
}

export function headersForLoopbackRequest(
  headers: HeaderPair[],
  rewrite: LoopbackHeaderRewrite,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of headers) {
    const lowerName = name.toLowerCase();
    if (SKIP_REQUEST_HEADERS.has(lowerName)) continue;
    forwarded[name] =
      lowerName === "origin" && value === rewrite.publicOrigin
        ? rewrite.loopbackOrigin
        : value;
  }
  if (rewrite.host !== undefined) {
    forwarded.Host = rewrite.host;
  }
  if (rewrite.connectViewerAccessToken !== undefined) {
    forwarded[CONNECT_VIEWER_ACCESS_HEADER] = rewrite.connectViewerAccessToken;
  }
  return forwarded;
}

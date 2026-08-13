import { useAtom } from "jotai";
import { createBooleanPreferenceAtom } from "./browser-storage";

export const REWRITE_LOCALHOST_LINKS_STORAGE_KEY = "bb.rewriteLocalhostLinks";

export const REWRITE_LOCALHOST_LINKS_DEFAULT = true;

interface RewriteLocalhostLinkHrefArgs {
  currentHostname: string | undefined;
  enabled: boolean;
  href: string | undefined;
}

const LOOPBACK_LINK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function isIpv4Hostname(value: string): boolean {
  const segments = value.split(".");
  return (
    segments.length === 4 &&
    segments.every((segment) => {
      if (!/^\d+$/u.test(segment)) return false;
      const parsed = Number(segment);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
    })
  );
}

/**
 * A named public host could be BB Connect (or another proxy), where replacing
 * only the hostname produces a non-existent host:port route. Keep legacy
 * loopback links literal there. Direct numeric LAN access retains the legacy
 * convenience without guessing a public tunnel URL.
 */
function canSubstituteLoopbackHostname(currentHostname: string): boolean {
  const hostname = currentHostname.toLowerCase();
  return LOOPBACK_LINK_HOSTNAMES.has(hostname) || isIpv4Hostname(hostname);
}

function isRewriteableLoopbackLink(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_LINK_HOSTNAMES.has(url.hostname.toLowerCase())
  );
}

export function rewriteLocalhostLinkHref({
  currentHostname,
  enabled,
  href,
}: RewriteLocalhostLinkHrefArgs): string | undefined {
  if (!enabled || href === undefined || currentHostname === undefined) {
    return href;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  if (!isRewriteableLoopbackLink(url)) {
    return href;
  }

  if (!canSubstituteLoopbackHostname(currentHostname)) {
    return href;
  }

  url.hostname = currentHostname;
  return url.toString();
}

export const rewriteLocalhostLinksPreferenceAtom = createBooleanPreferenceAtom(
  REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
  REWRITE_LOCALHOST_LINKS_DEFAULT,
);

export function useRewriteLocalhostLinksPreference() {
  return useAtom(rewriteLocalhostLinksPreferenceAtom);
}

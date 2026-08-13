import { describe, expect, it, vi } from "vitest";
import {
  environmentServiceViewerAccessToken,
  resolveEnvironmentServiceDestination,
} from "./environment-services.js";

const reference = {
  hostId: "host-environment",
  port: 4173,
  path: "/preview",
  query: "theme=dark",
  hash: "ready",
} as const;

const requestContext = (headers: Record<string, string>) => ({
  req: {
    header: (name: string) => headers[name],
  },
});

describe("environment service destinations", () => {
  it("opens a local service through loopback without consulting Connect", async () => {
    const resolveConnectShare = vi.fn();
    await expect(
      resolveEnvironmentServiceDestination({
        primaryHostId: "host-environment",
        reference,
        resolveConnectShare,
        viewer: "local",
      }),
    ).resolves.toEqual({
      kind: "destination",
      url: "http://localhost:4173/preview?theme=dark#ready",
    });
    expect(resolveConnectShare).not.toHaveBeenCalled();
  });

  it("uses the exact registered share for a Connect viewer, including a non-server host", async () => {
    const resolveConnectShare = vi.fn().mockResolvedValue({
      kind: "destination",
      url: "https://old-machbook-air--4173.getbb.app",
    });
    await expect(
      resolveEnvironmentServiceDestination({
        primaryHostId: "host-server",
        reference,
        resolveConnectShare,
        viewer: "connect",
      }),
    ).resolves.toEqual({
      kind: "destination",
      url: "https://old-machbook-air--4173.getbb.app/preview?theme=dark#ready",
    });
  });

  it("does not guess a local route for a different host or a stale Connect share", async () => {
    await expect(
      resolveEnvironmentServiceDestination({
        primaryHostId: "host-server",
        reference,
        resolveConnectShare: vi.fn(),
        viewer: "local",
      }),
    ).resolves.toEqual({
      kind: "unavailable",
      reason:
        "This service runs on another machine. Open this link through BB Connect after sharing the service.",
    });
    await expect(
      resolveEnvironmentServiceDestination({
        primaryHostId: "host-server",
        reference,
        resolveConnectShare: async () => ({
          kind: "unavailable" as const,
          reason: "This service is not currently shared through BB Connect.",
        }),
        viewer: "connect",
      }),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "This service is not currently shared through BB Connect.",
    });
  });

  it("requires the private tunnel marker as well as the gate-stamped session", () => {
    expect(environmentServiceViewerAccessToken(requestContext({}))).toBe(null);
    expect(
      environmentServiceViewerAccessToken(
        requestContext({ "x-bb-gate-auth": "machine" }),
      ),
    ).toBe(null);
    expect(
      environmentServiceViewerAccessToken(
        requestContext({ "x-bb-gate-auth": "session" }),
      ),
    ).toBe(null);
    expect(
      environmentServiceViewerAccessToken(
        requestContext({
          "x-bb-gate-auth": "session",
          "x-bb-connect-viewer-access": "tunnel-private-token",
        }),
      ),
    ).toBe("tunnel-private-token");
  });
});

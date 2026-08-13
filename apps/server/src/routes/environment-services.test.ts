import { describe, expect, it, vi } from "vitest";
import {
  classifyEnvironmentServiceViewer,
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

const requestContext = (
  headers: Record<string, string>,
  remoteAddress?: string,
) => ({
  req: {
    header: (name: string) => headers[name],
  },
  get: () => remoteAddress,
});

describe("environment service destinations", () => {
  it("opens a local service through loopback without consulting Connect", async () => {
    const resolveConnectShare = vi.fn();
    await expect(
      resolveEnvironmentServiceDestination({
        primaryHostId: "host-environment",
        reference,
        resolveConnectShare,
        viewer: "loopback",
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
        viewer: "loopback",
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

  it("does not send direct or unverified proxy viewers to any localhost service", async () => {
    for (const viewer of ["direct", "unknown"] as const) {
      const resolveConnectShare = vi.fn();
      await expect(
        resolveEnvironmentServiceDestination({
          primaryHostId: "host-environment",
          reference,
          resolveConnectShare,
          viewer,
        }),
      ).resolves.toEqual({
        kind: "unavailable",
        reason:
          viewer === "direct"
            ? "This service link was opened through a direct network address. Open BB at localhost on the service host, or open the link through BB Connect."
            : "BB could not verify that this viewer is on the service host. Open BB at localhost on the service host, or open the link through BB Connect.",
      });
      expect(resolveConnectShare).not.toHaveBeenCalled();
    }
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

  it("classifies loopback, direct-IP, Connect, and unknown proxy viewers separately", () => {
    expect(
      classifyEnvironmentServiceViewer(
        requestContext({ host: "localhost:17176" }, "127.0.0.1"),
      ),
    ).toEqual({ viewer: "loopback", viewerAccessToken: null });
    expect(
      classifyEnvironmentServiceViewer(
        requestContext({ host: "192.168.1.20:17176" }, "192.168.1.44"),
      ),
    ).toEqual({ viewer: "direct", viewerAccessToken: null });
    expect(
      classifyEnvironmentServiceViewer(
        requestContext({ host: "bb.example.test" }, "127.0.0.1"),
      ),
    ).toEqual({ viewer: "unknown", viewerAccessToken: null });
    expect(
      classifyEnvironmentServiceViewer(
        requestContext(
          {
            host: "brsbl.getbb.app",
            "x-bb-gate-auth": "session",
            "x-bb-connect-viewer-access": "tunnel-private-token",
          },
          "127.0.0.1",
        ),
      ),
    ).toEqual({
      viewer: "connect",
      viewerAccessToken: "tunnel-private-token",
    });
  });

  it("does not trust a forged Connect marker without the gate-stamped session", () => {
    expect(
      classifyEnvironmentServiceViewer(
        requestContext(
          {
            host: "192.168.1.20:17176",
            "x-bb-connect-viewer-access": "forged-token",
          },
          "192.168.1.44",
        ),
      ),
    ).toEqual({ viewer: "direct", viewerAccessToken: null });
  });
});

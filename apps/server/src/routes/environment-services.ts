import {
  environmentServiceLinkResolutionSchema,
  resolveEnvironmentServiceUrl,
  publicApiRoutes,
  typedRoutes,
  type EnvironmentServiceLinkResolution,
  type EnvironmentServiceReference,
  type PublicApiSchema,
} from "@bb/server-contract";
import { isIP } from "node:net";
import { isLoopbackAddress, isLoopbackHostname } from "@bb/config/loopback";
import { CONNECT_VIEWER_ACCESS_HEADER } from "@bb/tunnel-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  getGateAuthKind,
  getTrustedRemoteAddress,
  type GateAuthHeaderReader,
  type TrustedRemoteAddressReader,
} from "../request-context.js";
import { resolvePrimaryHostId } from "../services/hosts/primary-host.js";
import type { PluginService } from "../services/plugins/plugin-service.js";

const CONNECT_PLUGIN_ID = "connect";
const CONNECT_SERVICE_RESOLVER_METHOD = "resolveEnvironmentService";

export type EnvironmentServiceViewer =
  | "connect"
  | "loopback"
  | "direct"
  | "unknown";

export interface ResolveEnvironmentServiceDestinationArgs {
  primaryHostId: string | null;
  reference: EnvironmentServiceReference;
  resolveConnectShare: () => Promise<EnvironmentServiceLinkResolution>;
  viewer: EnvironmentServiceViewer;
}

/**
 * Select a network route only after the viewer is known. The service reference
 * itself never contains a localhost or connect URL.
 */
export async function resolveEnvironmentServiceDestination(
  args: ResolveEnvironmentServiceDestinationArgs,
): Promise<EnvironmentServiceLinkResolution> {
  if (args.viewer === "connect") {
    const share = await args.resolveConnectShare();
    if (share.kind === "unavailable") return share;
    return {
      kind: "destination",
      url: resolveEnvironmentServiceUrl(share.url, args.reference),
    };
  }

  if (args.viewer !== "loopback") {
    return {
      kind: "unavailable",
      reason:
        args.viewer === "direct"
          ? "This service link was opened through a direct network address. Open BB at localhost on the service host, or open the link through BB Connect."
          : "BB could not verify that this viewer is on the service host. Open BB at localhost on the service host, or open the link through BB Connect.",
    };
  }

  if (args.primaryHostId === null) {
    return {
      kind: "unavailable",
      reason: "This BB has no local service host yet.",
    };
  }
  if (args.primaryHostId !== args.reference.hostId) {
    return {
      kind: "unavailable",
      reason:
        "This service runs on another machine. Open this link through BB Connect after sharing the service.",
    };
  }
  return {
    kind: "destination",
    url: resolveEnvironmentServiceUrl(
      `http://localhost:${args.reference.port}`,
      args.reference,
    ),
  };
}

/**
 * The gate stamps the session header, then the enrolled tunnel appends its
 * private marker. A direct loopback request can forge neither combination.
 */
export function environmentServiceViewerAccessToken(
  context: GateAuthHeaderReader,
): string | null {
  if (getGateAuthKind(context) !== "session") return null;
  const token = context.req.header(CONNECT_VIEWER_ACCESS_HEADER)?.trim();
  return token ? token : null;
}

function requestHostname(context: GateAuthHeaderReader): string | null {
  const host = context.req.header("host")?.trim();
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export interface EnvironmentServiceViewerAccess {
  viewer: EnvironmentServiceViewer;
  viewerAccessToken: string | null;
}

/**
 * A local service URL is safe only for a direct loopback request using a
 * loopback host. Direct-IP and proxy requests cannot prove that the viewer is
 * on the service host, so they intentionally get an explicit safe fallback.
 */
export function classifyEnvironmentServiceViewer(
  context: GateAuthHeaderReader & TrustedRemoteAddressReader,
): EnvironmentServiceViewerAccess {
  const viewerAccessToken = environmentServiceViewerAccessToken(context);
  if (viewerAccessToken !== null) {
    return { viewer: "connect", viewerAccessToken };
  }

  const remoteAddress = getTrustedRemoteAddress(context);
  const hostname = requestHostname(context);
  if (
    remoteAddress !== undefined &&
    isLoopbackAddress(remoteAddress) &&
    hostname !== null &&
    isLoopbackHostname(hostname)
  ) {
    return { viewer: "loopback", viewerAccessToken: null };
  }
  if (
    remoteAddress !== undefined &&
    !isLoopbackAddress(remoteAddress) &&
    hostname !== null &&
    isIP(hostname) !== 0
  ) {
    return { viewer: "direct", viewerAccessToken: null };
  }
  return { viewer: "unknown", viewerAccessToken: null };
}

async function resolveConnectShare(
  plugins: PluginService,
  reference: EnvironmentServiceReference,
  viewerAccessToken: string,
): Promise<EnvironmentServiceLinkResolution> {
  const lookup = plugins.getRpcHandler(
    CONNECT_PLUGIN_ID,
    CONNECT_SERVICE_RESOLVER_METHOD,
  );
  if (lookup.outcome !== "found") {
    return {
      kind: "unavailable",
      reason:
        "BB Connect is unavailable, so this service cannot be opened from a remote viewer.",
    };
  }
  const result = await plugins.invokeRpcHandler(
    CONNECT_PLUGIN_ID,
    CONNECT_SERVICE_RESOLVER_METHOD,
    lookup.value,
    { reference, viewerAccessToken },
  );
  if (!result.ok) {
    return {
      kind: "unavailable",
      reason: "BB Connect could not resolve this shared service.",
    };
  }
  const parsed = environmentServiceLinkResolutionSchema.safeParse(
    result.result,
  );
  return parsed.success
    ? parsed.data
    : {
        kind: "unavailable",
        reason: "BB Connect returned an invalid shared-service destination.",
      };
}

export function registerEnvironmentServiceRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.environmentServices;
  get(routes.resolve, async (context, reference) => {
    const viewer = classifyEnvironmentServiceViewer(context);
    return context.json(
      await resolveEnvironmentServiceDestination({
        primaryHostId: resolvePrimaryHostId(deps),
        reference,
        resolveConnectShare: () =>
          resolveConnectShare(
            plugins,
            reference,
            viewer.viewerAccessToken ?? "",
          ),
        viewer: viewer.viewer,
      }),
    );
  });
}

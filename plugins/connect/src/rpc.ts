import { z } from "zod";
import { defineRpcContract, type PluginRpcHandlers } from "@bb/plugin-sdk";
import {
  environmentServiceLinkResolutionSchema,
  environmentServiceReferenceSchema,
} from "@bb/server-contract";
import {
  ConnectListError,
  type DesktopSession,
  type ListAccountServersResult,
} from "@bb/connect-client";
import { ConnectPairError } from "./redeem.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";
import { MachineCodeError, type MachineCode } from "./machine-code.js";
import type { ShareHostResolver } from "./hosts.js";
import type { ShareListing } from "./shares.js";
import { hasViewerAccessToken } from "./viewer-access.js";

const resolveEnvironmentServiceInputSchema = z
  .object({
    reference: environmentServiceReferenceSchema,
    viewerAccessToken: z.string().min(1),
  })
  .strict();

// Panel-facing rpc surface. `server` is optional: the dashboard command
// carries both --code and --server, but the panel's paste-a-code field only
// has the code — the server URL is then derived from the redeemed handle
// (https://<handle>.getbb.app). `baseUrl` overrides the connect cloud apex
// (tests and self-hosted gates).
const pairInputSchema = z.object({
  code: z.string().min(1),
  server: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
});

const portInputSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    hostId: z.string().min(1).optional(),
  })
  .strict();
const revokeMachineInputSchema = z.object({ machineId: z.string().min(1) });

const connectShareStatusSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    port: z.number().int(),
    createdAt: z.number(),
    url: z.string(),
    unavailableReason: z.string().optional(),
  })
  .strict();

const connectStatusSchema: z.ZodType<ConnectStatus> = z
  .object({
    state: z.enum(["disconnected", "pairing", "connected", "reconnecting"]),
    paired: z.boolean(),
    handle: z.string().nullable(),
    url: z.string().nullable(),
    dashboardUrl: z.string(),
    lastError: z.string().nullable(),
    nextRetryAt: z.number().nullable(),
    since: z.number(),
    remoteClients: z.number().int(),
    lastRemoteActivityAt: z.number().nullable(),
    shares: z.array(connectShareStatusSchema),
  })
  .strict();

const shareListingSchema: z.ZodType<ShareListing> = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    port: z.number().int(),
    createdAt: z.number(),
    url: z.string(),
    unavailableReason: z.string().optional(),
  })
  .strict();

const listAccountServersResultSchema: z.ZodType<ListAccountServersResult> = z
  .object({
    servers: z.array(
      z
        .object({
          handle: z.string(),
          name: z.string(),
          live: z.boolean(),
          url: z.string(),
        })
        .strict(),
    ),
    selfHandle: z.string(),
  })
  .strict();

const desktopSessionSchema: z.ZodType<DesktopSession> = z
  .object({
    cookie: z
      .object({
        domain: z.string(),
        expiresAt: z.number().int(),
        name: z.string(),
        value: z.string(),
      })
      .strict(),
  })
  .strict();

const machineCodeSchema: z.ZodType<MachineCode> = z
  .object({
    code: z.string(),
    expiresAt: z.number(),
    serverUrl: z.string(),
  })
  .strict();

export const connectRpcContract = defineRpcContract({
  pair: { input: pairInputSchema, output: connectStatusSchema },
  status: { input: z.null(), output: connectStatusSchema },
  disconnect: { input: z.null(), output: connectStatusSchema },
  expose: { input: portInputSchema, output: shareListingSchema },
  unexpose: {
    input: portInputSchema,
    output: z
      .object({
        removed: z.boolean(),
        hostId: z.string(),
        hostName: z.string(),
        port: z.number().int(),
      })
      .strict(),
  },
  listShares: { input: z.null(), output: z.array(shareListingSchema) },
  /** Core BB asks this for an existing registry entry; it never synthesizes one. */
  resolveEnvironmentService: {
    input: resolveEnvironmentServiceInputSchema,
    output: environmentServiceLinkResolutionSchema,
  },
  listAccountServers: {
    input: z.null(),
    output: listAccountServersResultSchema,
  },
  createDesktopSession: { input: z.null(), output: desktopSessionSchema },
  createMachineCode: { input: z.null(), output: machineCodeSchema },
  revokeMachine: {
    input: revokeMachineInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export type ConnectRpcHandlers = PluginRpcHandlers<typeof connectRpcContract>;

export function createRpcHandlers(
  tunnel: ConnectTunnel,
  hostResolver: ShareHostResolver,
  viewerAccessToken: string,
): ConnectRpcHandlers {
  return {
    async pair(args) {
      try {
        return await tunnel.pair({
          code: args.code,
          ...(args.server !== undefined ? { serverUrl: args.server } : {}),
          ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
        });
      } catch (error) {
        // The panel maps stable codes to human copy; raw detail stays in the
        // plugin log (see ConnectTunnel.pair). Never surface wire text.
        if (error instanceof ConnectPairError) {
          throw new Error(error.code);
        }
        throw error;
      }
    },
    async status() {
      return tunnel.refreshStatus();
    },
    async disconnect() {
      return tunnel.disconnect();
    },
    async expose(args) {
      const host =
        args.hostId === undefined
          ? await hostResolver.serverHost()
          : await hostResolver.byId(args.hostId);
      return tunnel.expose(args.port, host);
    },
    async unexpose(args) {
      return tunnel.unexpose(
        args.port,
        args.hostId ?? (await hostResolver.serverHostId()),
      );
    },
    async listShares() {
      return tunnel.listShares();
    },
    async resolveEnvironmentService(args) {
      if (!hasViewerAccessToken(viewerAccessToken, args.viewerAccessToken)) {
        return {
          kind: "unavailable" as const,
          reason:
            "This service link must be opened through an authenticated BB Connect viewer.",
        };
      }
      const { reference } = args;
      const listing = await tunnel.findShare(reference.hostId, reference.port);
      if (listing === undefined) {
        return {
          kind: "unavailable" as const,
          reason:
            "This service is not currently shared through BB Connect. Start the service, then run `bb connect expose <port>` from its thread.",
        };
      }
      if (listing.url.length === 0) {
        return {
          kind: "unavailable" as const,
          reason:
            listing.unavailableReason ??
            "This service's BB Connect share is currently unavailable.",
        };
      }
      return { kind: "destination" as const, url: listing.url };
    },
    async listAccountServers() {
      try {
        return await tunnel.listAccountServers();
      } catch (error) {
        // Stable codes for callers (CLI / panel); raw detail stays on the error
        // message for plugin logs when surfaced elsewhere.
        if (error instanceof ConnectListError) {
          throw new Error(error.code);
        }
        throw error;
      }
    },
    async createDesktopSession() {
      try {
        return await tunnel.createDesktopSession();
      } catch (error) {
        if (error instanceof ConnectListError) {
          throw new Error(error.code);
        }
        throw error;
      }
    },
    async createMachineCode() {
      try {
        return await tunnel.createMachineCode();
      } catch (error) {
        if (error instanceof MachineCodeError) {
          throw new Error(error.code);
        }
        throw error;
      }
    },
    async revokeMachine(args) {
      await tunnel.revokeMachine(args.machineId);
      return { ok: true };
    },
  };
}

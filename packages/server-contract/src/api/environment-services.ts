import { z } from "zod";

/**
 * A durable reference to an HTTP service owned by a BB environment host.
 *
 * This deliberately describes the service instead of one viewer's network
 * route. The app resolves it when someone opens the corresponding BB route.
 */
export const environmentServiceReferenceSchema = z
  .object({
    hostId: z.string().trim().min(1).max(256),
    port: z.number().int().min(1).max(65_535),
    path: z
      .string()
      .min(1)
      .max(8_192)
      .refine(
        (value) =>
          value.startsWith("/") &&
          !value.startsWith("//") &&
          !/[?#\r\n]/u.test(value),
        "path must be an absolute path without query or hash components",
      ),
    query: z
      .string()
      .max(8_192)
      .refine(
        (value) => !/[?#\r\n]/u.test(value),
        "query must not include ? or #",
      )
      .optional(),
    hash: z
      .string()
      .max(8_192)
      .refine((value) => !/[#\r\n]/u.test(value), "hash must not include #")
      .optional(),
  })
  .strict();
export type EnvironmentServiceReference = z.infer<
  typeof environmentServiceReferenceSchema
>;

export const environmentServiceReferenceQuerySchema = z
  .object({
    hostId: z.string(),
    port: z.coerce.number(),
    path: z.string(),
    query: z.string().optional(),
    hash: z.string().optional(),
  })
  .strict()
  .pipe(environmentServiceReferenceSchema);
export type EnvironmentServiceReferenceQuery = z.infer<
  typeof environmentServiceReferenceQuerySchema
>;

export const environmentServiceLinkResolutionSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("destination"),
        url: z.string().url(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("unavailable"),
        reason: z.string().min(1),
      })
      .strict(),
  ],
);
export type EnvironmentServiceLinkResolution = z.infer<
  typeof environmentServiceLinkResolutionSchema
>;

/** Connect's authoritative resolution for one already-registered share. */
export const environmentServiceShareResolutionSchema =
  environmentServiceLinkResolutionSchema;
export type EnvironmentServiceShareResolution = z.infer<
  typeof environmentServiceShareResolutionSchema
>;

export const ENVIRONMENT_SERVICE_ROUTE_PATH = "/services/:hostId/:port";

function resolvedUrl(
  base: string,
  reference: EnvironmentServiceReference,
): URL {
  const url = new URL(base);
  url.pathname = reference.path;
  url.search = reference.query === undefined ? "" : `?${reference.query}`;
  url.hash = reference.hash === undefined ? "" : `#${reference.hash}`;
  return url;
}

/** Build a service destination from a trusted base URL without changing its host. */
export function resolveEnvironmentServiceUrl(
  base: string,
  reference: EnvironmentServiceReference,
): string {
  return resolvedUrl(
    base,
    environmentServiceReferenceSchema.parse(reference),
  ).toString();
}

/**
 * The durable relative BB route agents, the CLI, and the SDK put in Markdown.
 * Its query encodes the path/query/hash separately so each component remains
 * validated rather than being recovered from a viewer-specific URL string.
 */
export function getEnvironmentServiceLinkPath(
  reference: EnvironmentServiceReference,
): string {
  const parsed = environmentServiceReferenceSchema.parse(reference);
  const query = new URLSearchParams({ path: parsed.path });
  if (parsed.query !== undefined) query.set("query", parsed.query);
  if (parsed.hash !== undefined) query.set("hash", parsed.hash);
  return `/services/${encodeURIComponent(parsed.hostId)}/${parsed.port}?${query.toString()}`;
}

/** Split a CLI-friendly absolute path into the canonical service fields. */
export function environmentServiceReferenceFromPath(args: {
  hostId: string;
  port: number;
  path: string;
}): EnvironmentServiceReference {
  if (!args.path.startsWith("/")) {
    throw new Error("--path must start with /");
  }
  const parsed = new URL(args.path, "http://bb.invalid");
  if (parsed.origin !== "http://bb.invalid") {
    throw new Error("--path must be a relative path");
  }
  return environmentServiceReferenceSchema.parse({
    hostId: args.hostId,
    port: args.port,
    path: parsed.pathname,
    ...(parsed.search.length > 1 ? { query: parsed.search.slice(1) } : {}),
    ...(parsed.hash.length > 1 ? { hash: parsed.hash.slice(1) } : {}),
  });
}

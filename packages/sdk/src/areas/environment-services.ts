import {
  getEnvironmentServiceLinkPath,
  type EnvironmentServiceLinkResolution,
  type EnvironmentServiceReference,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface ResolveEnvironmentServiceArgs {
  reference: EnvironmentServiceReference;
  signal?: AbortSignal;
}

export interface EnvironmentServicesArea {
  /** Create the portable relative BB link that belongs in persisted Markdown. */
  link(reference: EnvironmentServiceReference): string;
  /** Resolve a portable link for the current SDK caller. */
  resolve(
    args: ResolveEnvironmentServiceArgs,
  ): Promise<EnvironmentServiceLinkResolution>;
}

export function createEnvironmentServicesArea(
  args: CreateSdkAreaArgs,
): EnvironmentServicesArea {
  return {
    link(reference) {
      return getEnvironmentServiceLinkPath(reference);
    },
    resolve(input) {
      return args.transport.readJson(
        args.transport.api.v1["environment-services"].resolve.$get(
          { query: input.reference },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}

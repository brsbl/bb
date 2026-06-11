import type { ProviderAdapter } from "./provider-adapter.js";
import type {
  AgentRuntimeExecutionOptions,
  AgentRuntimeSkillRoot,
} from "./types.js";
import type { ProviderExecutionContext } from "./provider-adapter.js";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  DEFAULT_SUBMISSION_MODE,
  type SubmissionModeEntrypoint,
} from "@bb/domain";
import { resolveAdapterPermissionPolicy } from "./shared/permission-policy.js";

type SubmissionModeConsumption = SubmissionModeEntrypoint | "deferred" | "none";

interface AssertProviderSupportsExecutionOptionsArgs {
  adapter: ProviderAdapter;
  consumption: SubmissionModeConsumption;
  options: AgentRuntimeExecutionOptions;
  providerId: string;
}

interface ToProviderExecutionContextArgs {
  envVars: Record<string, string>;
  execOpts: AgentRuntimeExecutionOptions;
  instructions: string | undefined;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
}

interface SameExecutionSettingsArgs {
  left: AgentRuntimeExecutionOptions;
  right: AgentRuntimeExecutionOptions;
}

export function assertProviderSupportsExecutionOptions(
  args: AssertProviderSupportsExecutionOptionsArgs,
): void {
  if (
    args.options.serviceTier !== undefined &&
    args.options.serviceTier !== "default" &&
    !args.adapter.capabilities.supportsServiceTier
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support service tiers.`,
    );
  }

  if (
    !args.adapter.capabilities.supportedPermissionModes.includes(
      args.options.permissionMode,
    )
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support permission mode "${args.options.permissionMode}".`,
    );
  }

  if (
    args.options.submissionMode.planMode === DEFAULT_SUBMISSION_MODE.planMode &&
    args.options.submissionMode.goalMode === DEFAULT_SUBMISSION_MODE.goalMode
  ) {
    return;
  }

  if (args.consumption === "deferred") {
    return;
  }

  if (args.consumption === "none") {
    throw new Error(
      `Provider "${args.providerId}" cannot consume submission modes here.`,
    );
  }

  if (
    args.options.submissionMode.planMode === "plan" &&
    !args.adapter.capabilities.supportsPlanMode[args.consumption]
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support Plan mode for ${args.consumption}.`,
    );
  }

  if (
    args.options.submissionMode.goalMode === "goal" &&
    !args.adapter.capabilities.supportsGoalMode[args.consumption]
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support Goal mode for ${args.consumption}.`,
    );
  }
}

export function sameExecutionSettings(
  args: SameExecutionSettingsArgs,
): boolean {
  const leftMockCliTraffic =
    args.left.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  const rightMockCliTraffic =
    args.right.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  return (
    args.left.model === args.right.model &&
    args.left.serviceTier === args.right.serviceTier &&
    args.left.reasoningLevel === args.right.reasoningLevel &&
    args.left.workflowsEnabled === args.right.workflowsEnabled &&
    leftMockCliTraffic.enabled === rightMockCliTraffic.enabled &&
    leftMockCliTraffic.endpoint === rightMockCliTraffic.endpoint &&
    args.left.permissionMode === args.right.permissionMode &&
    args.left.permissionEscalation === args.right.permissionEscalation
  );
}

export function toProviderExecutionContext(
  args: ToProviderExecutionContextArgs,
): ProviderExecutionContext {
  const permissionPolicy = resolveAdapterPermissionPolicy(args.execOpts);
  return {
    model: args.execOpts.model,
    serviceTier: args.execOpts.serviceTier,
    reasoningLevel: args.execOpts.reasoningLevel,
    claudeCodeMockCliTraffic:
      args.execOpts.claudeCodeMockCliTraffic ??
      DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
    workflowsEnabled: args.execOpts.workflowsEnabled,
    submissionMode: args.execOpts.submissionMode,
    ...permissionPolicy,
    instructions: args.instructions,
    envVars: args.envVars,
    ...(args.skillRoots && args.skillRoots.length > 0
      ? { skillRoots: args.skillRoots }
      : {}),
  };
}

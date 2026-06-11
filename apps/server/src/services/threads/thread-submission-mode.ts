import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import {
  DEFAULT_SUBMISSION_MODE,
  type ProviderCapabilities,
  type SubmissionMode,
  type SubmissionModeEntrypoint,
} from "@bb/domain";
import { ApiError } from "../../errors.js";

export interface ResolveSubmissionModeArgs {
  submissionMode?: SubmissionMode;
}

export interface EnsureProviderSupportsSubmissionModeArgs {
  entrypoint: SubmissionModeEntrypoint;
  providerId: string;
  submissionMode: SubmissionMode;
}

function cloneDefaultSubmissionMode(): SubmissionMode {
  return { ...DEFAULT_SUBMISSION_MODE };
}

export function resolveSubmissionMode(
  args: ResolveSubmissionModeArgs,
): SubmissionMode {
  return args.submissionMode ?? cloneDefaultSubmissionMode();
}

export function isDefaultSubmissionMode(
  submissionMode: SubmissionMode,
): boolean {
  return (
    submissionMode.planMode === DEFAULT_SUBMISSION_MODE.planMode &&
    submissionMode.goalMode === DEFAULT_SUBMISSION_MODE.goalMode
  );
}

function providerCapabilities(
  providerId: string,
): ProviderCapabilities | null {
  if (!isAgentProviderId(providerId)) {
    return null;
  }
  return getBuiltInAgentProviderInfo(providerId).capabilities;
}

function createUnsupportedSubmissionModeError(message: string): ApiError {
  return new ApiError(400, "unsupported_submission_mode", message);
}

export function ensureProviderSupportsSubmissionMode(
  args: EnsureProviderSupportsSubmissionModeArgs,
): void {
  if (isDefaultSubmissionMode(args.submissionMode)) {
    return;
  }

  const capabilities = providerCapabilities(args.providerId);
  if (capabilities === null) {
    throw createUnsupportedSubmissionModeError(
      `Provider "${args.providerId}" does not support submission modes.`,
    );
  }

  if (
    args.submissionMode.planMode === "plan" &&
    !capabilities.supportsPlanMode[args.entrypoint]
  ) {
    throw createUnsupportedSubmissionModeError(
      `Provider "${args.providerId}" does not support Plan mode for ${args.entrypoint}.`,
    );
  }

  if (
    args.submissionMode.goalMode === "goal" &&
    !capabilities.supportsGoalMode[args.entrypoint]
  ) {
    throw createUnsupportedSubmissionModeError(
      `Provider "${args.providerId}" does not support Goal mode for ${args.entrypoint}.`,
    );
  }
}

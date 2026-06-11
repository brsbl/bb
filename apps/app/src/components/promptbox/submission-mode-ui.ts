import {
  DEFAULT_SUBMISSION_MODE,
  type SubmissionMode,
  type SubmissionModeEntrypoint,
  type SubmissionModeSupport,
} from "@bb/domain";

export interface SupportsSubmissionModeToggleArgs {
  entrypoint: SubmissionModeEntrypoint;
  support: SubmissionModeSupport;
}

export interface BuildComposerSubmissionModeArgs {
  entrypoint: SubmissionModeEntrypoint;
  goalModeChecked: boolean;
  goalModeSupport: SubmissionModeSupport;
  planModeChecked: boolean;
  planModeSupport: SubmissionModeSupport;
}

export function supportsSubmissionModeToggle({
  entrypoint,
  support,
}: SupportsSubmissionModeToggleArgs): boolean {
  return support[entrypoint];
}

export function buildComposerSubmissionMode({
  entrypoint,
  goalModeChecked,
  goalModeSupport,
  planModeChecked,
  planModeSupport,
}: BuildComposerSubmissionModeArgs): SubmissionMode {
  return {
    planMode:
      planModeChecked &&
      supportsSubmissionModeToggle({
        entrypoint,
        support: planModeSupport,
      })
        ? "plan"
        : DEFAULT_SUBMISSION_MODE.planMode,
    goalMode:
      goalModeChecked &&
      supportsSubmissionModeToggle({
        entrypoint,
        support: goalModeSupport,
      })
        ? "goal"
        : DEFAULT_SUBMISSION_MODE.goalMode,
  };
}

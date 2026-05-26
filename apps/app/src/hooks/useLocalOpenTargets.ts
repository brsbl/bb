import { useCallback, useMemo } from "react";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { appToast } from "@/components/ui/app-toast";
import {
  resolvePreferredWorkspaceOpenTarget,
  useWorkspaceOpenTargetPreference,
} from "@/lib/workspace-open-target-preference";
import { useHostDaemon } from "./useHostDaemon";
import { useWorkspaceOpenTargets } from "./useWorkspaceOpenTargets";

const LOCAL_OPEN_FAILURE_TITLE = "Failed to open file locally";
const LOCALHOST_DISCONNECTED_OPEN_DESCRIPTION = "Localhost is disconnected.";
const LOCALHOST_NO_OPEN_TARGETS_DESCRIPTION = "No local editor is available.";

export interface UseLocalOpenTargetsArgs {
  enabled: boolean;
}

export interface OpenLocalPathRequest {
  lineNumber: number | null;
  path: string;
}

export interface OpenPathInTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  targetId: WorkspaceOpenTargetId;
}

export interface OpenPathInPreferredTargetArgs extends OpenLocalPathRequest {}

export interface UseLocalOpenTargetsResult {
  canOpenPreferredEditorTarget: boolean;
  canOpenPreferredTarget: boolean;
  openPathInPreferredEditorTarget: (
    args: OpenPathInPreferredTargetArgs,
  ) => Promise<boolean>;
  openPathInPreferredTarget: (
    args: OpenPathInPreferredTargetArgs,
  ) => Promise<boolean>;
  preferredEditorTarget: WorkspaceOpenTarget | null;
  openPathInTarget: (args: OpenPathInTargetArgs) => Promise<boolean>;
  preferredTarget: WorkspaceOpenTarget | null;
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

interface OpenUnavailableDescriptionArgs {
  hasDaemon: boolean;
}

function getOpenUnavailableDescription(
  args: OpenUnavailableDescriptionArgs,
): string {
  if (!args.hasDaemon) {
    return LOCALHOST_DISCONNECTED_OPEN_DESCRIPTION;
  }

  return LOCALHOST_NO_OPEN_TARGETS_DESCRIPTION;
}

export function useLocalOpenTargets(
  args: UseLocalOpenTargetsArgs,
): UseLocalOpenTargetsResult {
  const { hasDaemon } = useHostDaemon();
  const { openWorkspace, workspaceOpenTargets } = useWorkspaceOpenTargets(args);
  const [preferredTargetId, setPreferredTargetId] =
    useWorkspaceOpenTargetPreference();
  // Resolve locally from the already-gated `workspaceOpenTargets` so that
  // callers passing `enabled: false` don't trigger a daemon fetch via the
  // global atom. The atom (and `usePreferredWorkspaceOpenTarget`) remain
  // available for callers that don't need the gating.
  const preferredTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId,
        targets: workspaceOpenTargets,
      }),
    [preferredTargetId, workspaceOpenTargets],
  );
  const preferredEditorTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId,
        targets: workspaceOpenTargets.filter(
          (target) => target.kind === "editor",
        ),
      }),
    [preferredTargetId, workspaceOpenTargets],
  );

  const openPathInTarget = useCallback(
    async (request: OpenPathInTargetArgs) => {
      const target = workspaceOpenTargets.find(
        (candidate) => candidate.id === request.targetId,
      );
      if (!target || !openWorkspace) {
        appToast.error(LOCAL_OPEN_FAILURE_TITLE, {
          description: getOpenUnavailableDescription({
            hasDaemon,
          }),
        });
        return false;
      }

      if (request.rememberTarget) {
        setPreferredTargetId(request.targetId);
      }

      try {
        await openWorkspace({
          lineNumber: request.lineNumber,
          path: request.path,
          targetId: request.targetId,
        });
        return true;
      } catch (error) {
        const description = error instanceof Error ? error.message : undefined;
        appToast.error(LOCAL_OPEN_FAILURE_TITLE, {
          ...(description ? { description } : {}),
        });
        return false;
      }
    },
    [
      hasDaemon,
      openWorkspace,
      setPreferredTargetId,
      workspaceOpenTargets,
    ],
  );

  const openPathInPreferredTarget = useCallback(
    async (request: OpenPathInPreferredTargetArgs) => {
      if (!preferredTarget) {
        appToast.error(LOCAL_OPEN_FAILURE_TITLE, {
          description: getOpenUnavailableDescription({
            hasDaemon,
          }),
        });
        return false;
      }

      return openPathInTarget({
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        targetId: preferredTarget.id,
      });
    },
    [
      hasDaemon,
      openPathInTarget,
      preferredTarget,
    ],
  );
  const openPathInPreferredEditorTarget = useCallback(
    async (request: OpenPathInPreferredTargetArgs) => {
      if (!preferredEditorTarget) {
        appToast.error(LOCAL_OPEN_FAILURE_TITLE, {
          description: getOpenUnavailableDescription({
            hasDaemon,
          }),
        });
        return false;
      }

      return openPathInTarget({
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        targetId: preferredEditorTarget.id,
      });
    },
    [
      hasDaemon,
      openPathInTarget,
      preferredEditorTarget,
    ],
  );

  return {
    canOpenPreferredEditorTarget: preferredEditorTarget !== null,
    canOpenPreferredTarget: preferredTarget !== null,
    openPathInPreferredEditorTarget,
    openPathInPreferredTarget,
    preferredEditorTarget,
    openPathInTarget,
    preferredTarget,
    workspaceOpenTargets,
  };
}

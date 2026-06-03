import type {
  HostDaemonCommand,
  HostDaemonCommandResult,
  HostDaemonDurableCommandType,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcCommandType,
  HostDaemonOnlineRpcResult,
  WorkspaceResolutionFailure,
} from "@bb/host-daemon-contract";
import type {
  WorkspaceStatus,
  ResolvedThreadExecutionOptions,
  RuntimeThreadExecutionOptions,
} from "@bb/domain";
import {
  defaultListModels,
  defaultListProviders,
  ExpectedCommandDispatchError,
  requireExistingEnvironment,
  type CommandDispatchOptions,
} from "./command-dispatch-support.js";
import { provisionEnvironment } from "./command-handlers/environment.js";
import { listHostBranches } from "./command-handlers/host-branches.js";
import {
  listHostFiles,
  listHostPaths,
  deleteHostRelativeFile,
  deleteHostRelativePath,
  readHostFile,
  readHostFileMetadata,
  readHostRelativeFile,
  writeHostRelativeFile,
} from "./command-handlers/host-files.js";
import { resolveInteractiveRequest } from "./command-handlers/interactive.js";
import {
  getReplayCapture,
  listReplayCaptures,
  removeReplayCapture,
  runReplay,
} from "./command-handlers/replay.js";
import {
  completeCodexInference,
  transcribeCodexVoice,
} from "./codex-chatgpt-client.js";
import { listManagerTemplatesCommand } from "./command-handlers/manager-templates.js";
import {
  ensureThreadRuntime,
  handleThreadDeleted,
  startThread,
  submitTurn,
} from "./command-handlers/thread.js";
import { WorkspaceError } from "@bb/host-workspace";
import { squashMerge } from "./command-handlers/workspace.js";
import {
  requireResolvedWorkspaceForCommand,
  resolveWorkspaceForCommand,
  workspaceResolutionFailureFromError,
} from "./workspace-resolution.js";

export {
  CommandDispatchError,
  getErrorCode,
  noopEventSink,
  type CommandDispatchOptions,
} from "./command-dispatch-support.js";

function recordReplayThreadMetadata(
  command:
    | Extract<HostDaemonCommand, { type: "thread.start" }>
    | Extract<HostDaemonCommand, { type: "turn.submit" }>,
  options: CommandDispatchOptions,
): void {
  if (!options.recordReplayCaptureThreadMetadata) {
    return;
  }
  const runtimeContext =
    command.type === "thread.start" ? command : command.resumeContext;
  options.recordReplayCaptureThreadMetadata({
    environmentId: command.environmentId,
    projectId: runtimeContext.projectId,
    providerId: runtimeContext.providerId,
    threadId: command.threadId,
    title: null,
  });
}

function isMissingThreadProviderAssociationError(
  error: unknown,
  threadId: string,
): boolean {
  return (
    error instanceof Error &&
    error.message === `No provider associated with thread "${threadId}"`
  );
}

/**
 * Translate runtime-shape execution options (which carry permissionEscalation
 * details and no source field) into the server-shape used by stored client
 * turn-request events, which is what the manifest persists for replay.
 */
function toReplayCaptureExecution(
  options: RuntimeThreadExecutionOptions,
): ResolvedThreadExecutionOptions {
  return {
    model: options.model,
    serviceTier: options.serviceTier,
    reasoningLevel: options.reasoningLevel,
    permissionMode: options.permissionMode,
    source: "client/turn/requested",
  };
}

function recordReplayTurnRequest(
  command:
    | Extract<HostDaemonCommand, { type: "thread.start" }>
    | Extract<HostDaemonCommand, { type: "turn.submit" }>,
  options: CommandDispatchOptions,
): void {
  if (!options.recordReplayCaptureTurnRequest) {
    return;
  }
  if (command.type === "thread.start") {
    options.recordReplayCaptureTurnRequest({
      threadId: command.threadId,
      kind: "thread-start",
      input: command.input,
      execution: toReplayCaptureExecution(command.options),
    });
    return;
  }
  // Only "start" guarantees a new turn (and thus a turn/started event that
  // consumes the buffered request). "auto" and "steer" may resolve to a steer
  // that emits no turn/started — leaving a stale request that would mislabel
  // a later capture. Skip them.
  if (command.target.mode !== "start") {
    return;
  }
  options.recordReplayCaptureTurnRequest({
    threadId: command.threadId,
    kind: "turn-start",
    input: command.input,
    execution: toReplayCaptureExecution(command.options),
  });
}

type CommandHandlerMap = {
  [TType in HostDaemonDurableCommandType]: (
    command: Extract<HostDaemonCommand, { type: TType }>,
    options: CommandDispatchOptions,
  ) => Promise<HostDaemonCommandResult<TType>>;
};

type OnlineRpcHandlerMap = {
  [TType in HostDaemonOnlineRpcCommandType]: (
    command: Extract<HostDaemonOnlineRpcCommand, { type: TType }>,
    options: CommandDispatchOptions,
  ) => Promise<HostDaemonOnlineRpcResult<TType>>;
};

type EnvironmentCleanupPreflightCommand = Extract<
  HostDaemonCommand,
  { type: "environment.cleanup_preflight" }
>;
type EnvironmentCleanupPreflightResult =
  HostDaemonCommandResult<"environment.cleanup_preflight">;

function throwExpectedWorkspacePathNotFoundOrRethrow(error: unknown): never {
  if (error instanceof WorkspaceError && error.code === "path_not_found") {
    throw new ExpectedCommandDispatchError(error.code, error.message);
  }
  throw error;
}

function workspaceHasCleanupRisk(workspaceStatus: WorkspaceStatus): boolean {
  return (
    workspaceStatus.workingTree.hasUncommittedChanges ||
    workspaceStatus.mergeBase?.hasCommittedUnmergedChanges === true
  );
}

function cleanupPreflightFailureResult(
  failure: WorkspaceResolutionFailure,
): EnvironmentCleanupPreflightResult {
  if (failure.code === "path_not_found") {
    return { outcome: "already_missing", failure };
  }
  if (failure.code === "not_git_repo") {
    return { outcome: "not_inspectable", failure };
  }
  return { outcome: "probe_failed", failure };
}

function throwWorkspaceResolutionFailure(
  failure: WorkspaceResolutionFailure,
): never {
  throw new ExpectedCommandDispatchError(failure.code, failure.message);
}

async function environmentCleanupPreflight(
  command: EnvironmentCleanupPreflightCommand,
  options: CommandDispatchOptions,
): Promise<EnvironmentCleanupPreflightResult> {
  const resolution = await resolveWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  if (!resolution.ok) {
    return cleanupPreflightFailureResult(resolution.failure);
  }

  const { entry } = resolution;
  if (!entry.workspace.isGitRepo) {
    return cleanupPreflightFailureResult({
      code: "not_git_repo",
      message: `Path is not a git repository: ${entry.workspace.path}`,
      workspacePath: entry.workspace.path,
    });
  }
  if (
    command.workspaceContext.workspaceProvisionType === "managed-worktree" &&
    !entry.workspace.isWorktree
  ) {
    return cleanupPreflightFailureResult({
      code: "not_worktree",
      message: `Path is not a git worktree: ${entry.workspace.path}`,
      workspacePath: entry.workspace.path,
    });
  }

  try {
    const workspaceStatus = await entry.workspace.getStatus({
      mergeBaseBranch: command.mergeBaseBranch,
    });
    if (workspaceHasCleanupRisk(workspaceStatus)) {
      return {
        outcome: "blocked_by_changes",
        message: "Workspace has uncommitted or unmerged changes",
      };
    }
    return { outcome: "safe_to_destroy" };
  } catch (error) {
    const failure = workspaceResolutionFailureFromError({
      error,
      workspacePath: command.workspaceContext.workspacePath,
    });
    return cleanupPreflightFailureResult(failure);
  }
}

const commandHandlers: CommandHandlerMap = {
  "thread.start": async (
    command: Extract<HostDaemonCommand, { type: "thread.start" }>,
    options: CommandDispatchOptions,
  ) => {
    recordReplayThreadMetadata(command, options);
    recordReplayTurnRequest(command, options);
    return startThread(command, options);
  },
  "turn.submit": async (
    command: Extract<HostDaemonCommand, { type: "turn.submit" }>,
    options: CommandDispatchOptions,
  ) => {
    recordReplayThreadMetadata(command, options);
    recordReplayTurnRequest(command, options);
    const entry = await ensureThreadRuntime(command, options);
    return submitTurn(command, entry, options);
  },
  "thread.stop": async (
    command: Extract<HostDaemonCommand, { type: "thread.stop" }>,
    options: CommandDispatchOptions,
  ) => {
    const replayTask = options.replayTasks?.get(command.threadId);
    if (replayTask) {
      replayTask.abort.abort();
      return {};
    }
    const entry = await requireExistingEnvironment(
      command.environmentId,
      options.runtimeManager,
    );
    try {
      await entry.runtime.stopThread({ threadId: command.threadId });
    } catch (error) {
      if (!isMissingThreadProviderAssociationError(error, command.threadId)) {
        throw error;
      }
    }
    // Stop completion finalizes server-side thread state. Flush provider
    // events first so buffered lifecycle events cannot arrive after that.
    await options.eventSink.flush();
    options.runtimeManager.forgetThread(
      command.environmentId,
      command.threadId,
    );
    return {};
  },
  "thread.rename": async (
    command: Extract<HostDaemonCommand, { type: "thread.rename" }>,
    options: CommandDispatchOptions,
  ) => {
    const entry = await options.runtimeManager.getOrAwait(
      command.environmentId,
    );
    if (!entry) {
      return {};
    }
    await entry.runtime.renameThread({
      threadId: command.threadId,
      title: command.title,
    });
    return {};
  },
  "thread.archive": async (
    command: Extract<HostDaemonCommand, { type: "thread.archive" }>,
    options: CommandDispatchOptions,
  ) => {
    const entry = await requireResolvedWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    await entry.runtime.archiveThread({
      threadId: command.threadId,
      providerId: command.providerId,
      providerThreadId: command.providerThreadId,
    });
    options.runtimeManager.forgetThread(
      command.environmentId,
      command.threadId,
    );
    return {};
  },
  "thread.unarchive": async (
    command: Extract<HostDaemonCommand, { type: "thread.unarchive" }>,
    options: CommandDispatchOptions,
  ) => {
    const runtime =
      await options.runtimeManager.ensureProviderMaintenanceRuntime({
        dataDir: options.dataDir,
      });
    await runtime.unarchiveThread({
      threadId: command.threadId,
      providerId: command.providerId,
      providerThreadId: command.providerThreadId,
    });
    return {};
  },
  "thread.deleted": async (
    command: Extract<HostDaemonCommand, { type: "thread.deleted" }>,
    options: CommandDispatchOptions,
  ) => handleThreadDeleted(command, options),
  "interactive.resolve": async (
    command: Extract<HostDaemonCommand, { type: "interactive.resolve" }>,
    options: CommandDispatchOptions,
  ) => resolveInteractiveRequest(command, options),
  "codex.inference.complete": async (
    command: Extract<HostDaemonCommand, { type: "codex.inference.complete" }>,
    _options: CommandDispatchOptions,
  ) => completeCodexInference(command),
  "codex.voice.transcribe": async (
    command: Extract<HostDaemonCommand, { type: "codex.voice.transcribe" }>,
    _options: CommandDispatchOptions,
  ) => transcribeCodexVoice(command),
  "host.write_file_relative": async (
    command: Extract<HostDaemonCommand, { type: "host.write_file_relative" }>,
    _options: CommandDispatchOptions,
  ) => writeHostRelativeFile(command),
  "host.delete_file_relative": async (
    command: Extract<HostDaemonCommand, { type: "host.delete_file_relative" }>,
    _options: CommandDispatchOptions,
  ) => deleteHostRelativeFile(command),
  "host.delete_path_relative": async (
    command: Extract<HostDaemonCommand, { type: "host.delete_path_relative" }>,
    _options: CommandDispatchOptions,
  ) => deleteHostRelativePath(command),
  "environment.provision": async (
    command: Extract<HostDaemonCommand, { type: "environment.provision" }>,
    options: CommandDispatchOptions,
  ) => provisionEnvironment(command, options),
  "environment.cleanup_preflight": async (
    command: EnvironmentCleanupPreflightCommand,
    options: CommandDispatchOptions,
  ) => environmentCleanupPreflight(command, options),
  "environment.destroy": async (
    command: Extract<HostDaemonCommand, { type: "environment.destroy" }>,
    options: CommandDispatchOptions,
  ) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    if (!resolution.ok) {
      // Treat already-missing workspaces as successful destroy (idempotent retry).
      if (resolution.failure.code === "path_not_found") {
        return {};
      }
      throwWorkspaceResolutionFailure(resolution.failure);
    }
    options.terminalManager?.closeEnvironmentTerminals(
      command.environmentId,
      "environment-destroyed",
    );
    await options.runtimeManager.destroyEnvironment(command.environmentId);
    return {};
  },
  "workspace.commit": async (
    command: Extract<HostDaemonCommand, { type: "workspace.commit" }>,
    options: CommandDispatchOptions,
  ) => {
    const entry = await requireResolvedWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    return entry.workspace.commit({
      message: command.message,
      noVerify: true,
    });
  },
  "workspace.squash_merge": async (
    command: Extract<HostDaemonCommand, { type: "workspace.squash_merge" }>,
    options: CommandDispatchOptions,
  ) => squashMerge(command, options),
};

const onlineRpcHandlers: OnlineRpcHandlerMap = {
  "development.replay": dispatchDevelopmentReplayCommand,
  "host.list_files": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "host.list_files" }>,
    _options: CommandDispatchOptions,
  ) => listHostFiles(command),
  "host.list_paths": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "host.list_paths" }>,
    _options: CommandDispatchOptions,
  ) => listHostPaths(command),
  "host.list_branches": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "host.list_branches" }>,
    _options: CommandDispatchOptions,
  ) => listHostBranches(command),
  "host.list_manager_templates": async (
    command: Extract<
      HostDaemonOnlineRpcCommand,
      { type: "host.list_manager_templates" }
    >,
    options: CommandDispatchOptions,
  ) => listManagerTemplatesCommand(command, { dataDir: options.dataDir }),
  "host.file_metadata": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "host.file_metadata" }>,
    _options: CommandDispatchOptions,
  ) => readHostFileMetadata(command),
  "host.read_file": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "host.read_file" }>,
    _options: CommandDispatchOptions,
  ) => readHostFile(command),
  "host.read_file_relative": async (
    command: Extract<
      HostDaemonOnlineRpcCommand,
      { type: "host.read_file_relative" }
    >,
    _options: CommandDispatchOptions,
  ) => readHostRelativeFile(command),
  "provider.list": async (
    _command: Extract<HostDaemonOnlineRpcCommand, { type: "provider.list" }>,
    options: CommandDispatchOptions,
  ) => ({
    providers: (options.listProviders ?? defaultListProviders)(),
  }),
  "provider.list_models": async (
    command: Extract<
      HostDaemonOnlineRpcCommand,
      { type: "provider.list_models" }
    >,
    options: CommandDispatchOptions,
  ) =>
    (options.listModels ?? defaultListModels)({
      providerId: command.providerId,
    }),
  "workspace.status": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "workspace.status" }>,
    options: CommandDispatchOptions,
  ) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    if (!resolution.ok) {
      return { outcome: "unavailable", failure: resolution.failure };
    }
    try {
      return {
        outcome: "available",
        workspaceStatus: await resolution.entry.workspace.getStatus({
          mergeBaseBranch: command.mergeBaseBranch,
        }),
      };
    } catch (error) {
      return {
        outcome: "unavailable",
        failure: workspaceResolutionFailureFromError({
          error,
          workspacePath: command.workspaceContext.workspacePath,
        }),
      };
    }
  },
  "workspace.diff": async (
    command: Extract<HostDaemonOnlineRpcCommand, { type: "workspace.diff" }>,
    options: CommandDispatchOptions,
  ) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    if (!resolution.ok) {
      return { outcome: "unavailable", failure: resolution.failure };
    }
    try {
      return {
        outcome: "available",
        diff: await resolution.entry.workspace.getDiff({
          target: command.target,
          maxDiffBytes: command.maxDiffBytes,
          maxFileListBytes: command.maxFileListBytes,
        }),
      };
    } catch (error) {
      return {
        outcome: "unavailable",
        failure: workspaceResolutionFailureFromError({
          error,
          workspacePath: command.workspaceContext.workspacePath,
        }),
      };
    }
  },
};

function dispatchCommandByType<TType extends HostDaemonDurableCommandType>(
  type: TType,
  command: Extract<HostDaemonCommand, { type: TType }>,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<TType>> {
  return commandHandlers[type](command, options);
}

export async function dispatchCommand<
  TType extends HostDaemonDurableCommandType,
>(
  command: Extract<HostDaemonCommand, { type: TType }>,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<TType>> {
  try {
    return await dispatchCommandByType(command.type, command, options);
  } catch (error) {
    throwExpectedWorkspacePathNotFoundOrRethrow(error);
  }
}

type DevelopmentReplayCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay" }
>;

export async function dispatchDevelopmentReplayCommand(
  command: DevelopmentReplayCommand,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"development.replay">> {
  try {
    switch (command.operation) {
      case "capture-list":
        return await listReplayCaptures(options);
      case "capture-get":
        return await getReplayCapture(command, options);
      case "capture-delete":
        return await removeReplayCapture(command, options);
      case "run":
        return await runReplay(command, options);
    }
  } catch (error) {
    throwExpectedWorkspacePathNotFoundOrRethrow(error);
  }
}

function dispatchOnlineRpcCommandByType<TType extends HostDaemonOnlineRpcCommandType>(
  type: TType,
  command: Extract<HostDaemonOnlineRpcCommand, { type: TType }>,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<TType>> {
  return onlineRpcHandlers[type](command, options);
}

export async function dispatchOnlineRpcCommand<
  TType extends HostDaemonOnlineRpcCommandType,
>(
  command: Extract<HostDaemonOnlineRpcCommand, { type: TType }>,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<TType>> {
  try {
    return await dispatchOnlineRpcCommandByType(command.type, command, options);
  } catch (error) {
    throwExpectedWorkspacePathNotFoundOrRethrow(error);
  }
}

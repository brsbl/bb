import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
} from "@bb/process-utils";
import type { AgentRuntimeCaptureEntry } from "./capture-types.js";
import type {
  ProviderAdapter,
  ProviderAdapterFactory,
} from "./provider-adapter.js";
import { createProviderForId } from "./provider-registry.js";
import { filterSkillRootsForProvider } from "./runtime-skill-roots.js";
import {
  ignoredJsonRpcResultSchema,
  type PendingJsonRpcRequest,
  sendJsonRpcRequest,
} from "./runtime-json-rpc.js";
import type { RuntimeProviderIdentityState } from "./runtime-thread-identity.js";
import type { AgentRuntimeOptions, AgentRuntimeSkillRoot } from "./types.js";

/**
 * Opaque handle identifying a single caller's expected-shutdown mark. Each
 * `markProviderShutdownExpected` call mints a fresh token so overlapping callers
 * can each clear only their own mark without disturbing another caller's.
 */
export type ProviderShutdownToken = symbol;

function createProviderShutdownToken(): ProviderShutdownToken {
  return Symbol("provider-shutdown-expected");
}

export interface RuntimeProviderProcess {
  adapter: ProviderAdapter;
  child: ChildProcess;
  /**
   * Outstanding expected-shutdown marks. A process exit is treated as expected
   * when this set is non-empty; it is consumed (cleared) on exit. A set rather
   * than a boolean so concurrent callers cannot clear each other's mark.
   */
  expectedShutdownTokens: Set<ProviderShutdownToken>;
  identity: RuntimeProviderIdentityState;
  interactiveRequestScope: string;
  pending: Map<string | number, PendingJsonRpcRequest>;
  stderrChunks: string[];
}

export interface RuntimeProviderProcessLineArgs {
  line: string;
  providerProcess: RuntimeProviderProcess;
}

export interface RuntimeProviderProcessManagerArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  adapterFactory?: ProviderAdapterFactory;
  bridgeBundleDir: string | undefined;
  createProviderIdentityState: (
    providerId: string,
  ) => RuntimeProviderIdentityState;
  emitCapture: (entry: AgentRuntimeCaptureEntry) => void;
  env: Record<string, string> | undefined;
  getNextRequestId: () => number;
  handleStdoutLine: (args: RuntimeProviderProcessLineArgs) => void;
  onProcessExit: AgentRuntimeOptions["onProcessExit"];
  onProviderIdentityWaitersInterrupted: (
    providerProcess: RuntimeProviderProcess,
  ) => void;
  onProviderThreadDetached: (threadId: string) => void;
  onStderr: AgentRuntimeOptions["onStderr"];
  skillRoots: readonly AgentRuntimeSkillRoot[];
  workspacePath: string;
}

export interface EnsureRuntimeProviderArgs {
  providerId: string;
}

export interface ShutdownRuntimeProviderArgs {
  providerId: string;
  timeoutMs?: number;
}

export interface ProviderShutdownExpectedArgs {
  providerId: string;
}

export interface ClearProviderShutdownExpectedArgs {
  providerId: string;
  token: ProviderShutdownToken;
}

interface CleanupFailedStartupArgs {
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  startupError: Error;
}

interface TerminateProviderProcessArgs {
  providerProcess: RuntimeProviderProcess;
  timeoutMs?: number;
}

function createAdapterTurnIdPrefix(): string {
  const adapterId = randomUUID().replaceAll("-", "").slice(0, 16);
  return `turn_${adapterId}_`;
}

export class RuntimeProviderProcessManager {
  private readonly args: RuntimeProviderProcessManagerArgs;
  private readonly processes = new Map<string, RuntimeProviderProcess>();
  private readonly providerStarting = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(args: RuntimeProviderProcessManagerArgs) {
    this.args = args;
  }

  async ensureProvider(args: EnsureRuntimeProviderArgs): Promise<void> {
    if (this.processes.has(args.providerId)) return;

    const existing = this.providerStarting.get(args.providerId);
    if (existing) {
      await existing;
      return;
    }

    const startPromise = (async () => {
      const adapter = this.getAdapter(args.providerId);
      const providerProcess = this.spawnProvider(args.providerId, adapter);

      try {
        if (providerProcess.child.exitCode !== null) {
          const stderr = providerProcess.stderrChunks.join("\n").slice(0, 500);
          throw new Error(
            `Provider "${args.providerId}" exited during startup with code ${providerProcess.child.exitCode}` +
              (stderr ? `\nstderr: ${stderr}` : ""),
          );
        }

        const initCmd = adapter.buildCommandPlan({ type: "initialize" });
        if (initCmd.kind === "request") {
          await sendJsonRpcRequest({
            child: providerProcess.child,
            message: initCmd,
            pending: providerProcess.pending,
            getNextId: this.args.getNextRequestId,
            resultSchema: ignoredJsonRpcResultSchema,
          });
        }

        const providerSkillRoots = filterSkillRootsForProvider({
          providerId: args.providerId,
          skillRoots: this.args.skillRoots,
        });
        if (providerSkillRoots.length > 0) {
          const skillRootsCmd = adapter.buildCommandPlan({
            type: "skills/configure",
            skillRoots: providerSkillRoots,
          });
          if (skillRootsCmd.kind === "request") {
            await sendJsonRpcRequest({
              child: providerProcess.child,
              message: skillRootsCmd,
              pending: providerProcess.pending,
              getNextId: this.args.getNextRequestId,
              resultSchema: ignoredJsonRpcResultSchema,
            });
          }
        }
      } catch (startupError) {
        await this.cleanupFailedStartup({
          providerId: args.providerId,
          providerProcess,
          startupError:
            startupError instanceof Error
              ? startupError
              : new Error(String(startupError)),
        });
        throw startupError;
      }
    })();

    this.providerStarting.set(args.providerId, startPromise);
    try {
      await startPromise;
    } finally {
      this.providerStarting.delete(args.providerId);
    }
  }

  requireProviderProcess(providerId: string): RuntimeProviderProcess {
    const providerProcess = this.processes.get(providerId);
    if (!providerProcess) {
      throw new Error(`Provider "${providerId}" is not running`);
    }
    if (providerProcess.child.exitCode !== null) {
      this.processes.delete(providerId);
      throw new Error(
        `Provider "${providerId}" has exited (code ${providerProcess.child.exitCode})`,
      );
    }
    return providerProcess;
  }

  listRunningProviders(): string[] {
    return [...this.processes.keys()];
  }

  async shutdownProvider(args: ShutdownRuntimeProviderArgs): Promise<void> {
    const providerProcess = this.processes.get(args.providerId);
    if (!providerProcess || providerProcess.child.exitCode !== null) {
      return;
    }

    providerProcess.expectedShutdownTokens.add(createProviderShutdownToken());
    await this.terminateProviderProcess({
      providerProcess,
      timeoutMs: args.timeoutMs,
    });
  }

  /**
   * Marks the provider's next process exit as an expected shutdown without
   * terminating it, returning a token the caller passes to
   * {@link clearProviderShutdownExpected} to undo only its own mark. Callers that
   * are about to tear a provider down (for example a restart-provider stop) use
   * this so an exit while their request is still in flight is treated as the
   * intended shutdown rather than an unexpected crash. Returns `null` when the
   * provider is gone or already exited (nothing to mark or later clear).
   */
  markProviderShutdownExpected(
    args: ProviderShutdownExpectedArgs,
  ): ProviderShutdownToken | null {
    const providerProcess = this.processes.get(args.providerId);
    if (!providerProcess || hasChildProcessExited(providerProcess.child)) {
      return null;
    }
    const token = createProviderShutdownToken();
    providerProcess.expectedShutdownTokens.add(token);
    return token;
  }

  /**
   * Undoes a single {@link markProviderShutdownExpected} mark when the
   * anticipated teardown did not happen, so a later unrelated exit is not
   * silently treated as an expected shutdown. Only the matching token is
   * removed, leaving any concurrent caller's mark intact.
   */
  clearProviderShutdownExpected(args: ClearProviderShutdownExpectedArgs): void {
    const providerProcess = this.processes.get(args.providerId);
    if (!providerProcess) {
      return;
    }
    providerProcess.expectedShutdownTokens.delete(args.token);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const shutdownPromises: Promise<void>[] = [];

    for (const [providerId, providerProcess] of this.processes) {
      shutdownPromises.push(
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            providerProcess.child.kill("SIGKILL");
            resolve();
          }, 5000);

          providerProcess.child.on("exit", () => {
            clearTimeout(timer);
            resolve();
          });

          providerProcess.child.kill("SIGTERM");
        }),
      );
      for (const [, pending] of providerProcess.pending) {
        pending.reject(new Error("Runtime shutting down"));
      }
      providerProcess.pending.clear();
      this.args.onProviderIdentityWaitersInterrupted(providerProcess);

      for (const threadId of providerProcess.identity.threadIds) {
        this.args.onProviderThreadDetached(threadId);
      }
      this.processes.delete(providerId);
    }

    await Promise.all(shutdownPromises);
  }

  private getAdapter(providerId: string): ProviderAdapter {
    const adapterOptions = {
      additionalWorkspaceWriteRoots: this.args.additionalWorkspaceWriteRoots,
      bridgeBundleDir: this.args.bridgeBundleDir,
      turnIdPrefix: createAdapterTurnIdPrefix(),
    };

    if (this.args.adapterFactory) {
      return this.args.adapterFactory(providerId, adapterOptions);
    }
    return createProviderForId(providerId, adapterOptions);
  }

  private spawnProvider(
    providerId: string,
    adapter: ProviderAdapter,
  ): RuntimeProviderProcess {
    const env: NodeJS.ProcessEnv = {
      ...sanitizeInheritedChildProcessEnv({ env: process.env }),
      ...this.args.env,
    };
    const processConfig = adapter.process;

    const child = spawnPortablePipedProcess({
      command: processConfig.command,
      args: processConfig.args,
      cwd: this.args.workspacePath,
      env,
    });

    const providerProcess: RuntimeProviderProcess = {
      child,
      adapter,
      expectedShutdownTokens: new Set(),
      interactiveRequestScope: randomUUID(),
      identity: this.args.createProviderIdentityState(providerId),
      pending: new Map(),
      stderrChunks: [],
    };

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (this.shuttingDown) {
        return;
      }
      this.args.handleStdoutLine({
        line,
        providerProcess,
      });
    });

    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      if (this.shuttingDown) {
        return;
      }
      providerProcess.stderrChunks.push(line);
      this.args.onStderr?.(line);
      this.args.emitCapture({
        kind: "provider-stderr",
        capturedAt: Date.now(),
        providerId,
        line,
      });
    });

    child.on("error", (err) => {
      this.handleProviderProcessError({
        err,
        providerId,
        providerProcess,
      });
    });
    child.on("exit", (code, signal) => {
      this.handleProviderProcessExit({
        code: code ?? null,
        providerId,
        providerProcess,
        signal: signal ?? null,
      });
    });

    this.processes.set(providerId, providerProcess);
    return providerProcess;
  }

  private async cleanupFailedStartup(
    args: CleanupFailedStartupArgs,
  ): Promise<void> {
    if (this.processes.get(args.providerId) !== args.providerProcess) {
      return;
    }

    this.processes.delete(args.providerId);
    args.providerProcess.expectedShutdownTokens.add(
      createProviderShutdownToken(),
    );
    for (const [, pending] of args.providerProcess.pending) {
      pending.reject(args.startupError);
    }
    args.providerProcess.pending.clear();
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    await this.terminateProviderProcess({
      providerProcess: args.providerProcess,
    });
  }

  private async terminateProviderProcess(
    args: TerminateProviderProcessArgs,
  ): Promise<void> {
    if (args.providerProcess.child.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeoutMs = args.timeoutMs ?? 5000;
      const softTimer = setTimeout(() => {
        if (args.providerProcess.child.exitCode === null) {
          args.providerProcess.child.kill("SIGKILL");
        }
      }, timeoutMs);
      const hardTimer = setTimeout(resolve, timeoutMs + 1000);

      args.providerProcess.child.once("exit", () => {
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
        resolve();
      });

      args.providerProcess.child.kill("SIGTERM");
    });
  }

  private handleProviderProcessError(args: ProviderProcessErrorArgs): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentProviderProcess(args)) return;
    const expected = consumeExpectedProviderProcessShutdown(
      args.providerProcess,
    );
    this.processes.delete(args.providerId);
    const message = args.err.message;
    for (const [, pending] of args.providerProcess.pending) {
      pending.reject(
        new Error(`Provider "${args.providerId}" failed to start: ${message}`),
      );
    }
    args.providerProcess.pending.clear();
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    this.args.emitCapture({
      kind: "provider-process-error",
      capturedAt: Date.now(),
      providerId: args.providerId,
      message,
    });

    this.args.onProcessExit?.({
      providerId: args.providerId,
      threadIds: [...args.providerProcess.identity.threadIds],
      code: null,
      expected,
      signal: null,
      stderr: null,
    });
  }

  private handleProviderProcessExit(args: ProviderProcessExitArgs): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentProviderProcess(args)) return;
    const expected = consumeExpectedProviderProcessShutdown(
      args.providerProcess,
    );
    this.processes.delete(args.providerId);
    const threadIds = [...args.providerProcess.identity.threadIds];
    for (const threadId of threadIds) {
      this.args.onProviderThreadDetached(threadId);
    }
    for (const [, pending] of args.providerProcess.pending) {
      const stderr = formatProviderStderr(args.providerProcess.stderrChunks);
      pending.reject(
        new Error(
          `Provider "${args.providerId}" exited unexpectedly` +
            (stderr ? `\nstderr: ${stderr}` : ""),
        ),
      );
    }
    args.providerProcess.pending.clear();
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    this.args.emitCapture({
      kind: "provider-process-exit",
      capturedAt: Date.now(),
      providerId: args.providerId,
      threadIds,
      code: args.code,
      signal: args.signal,
      stderrChunks: [...args.providerProcess.stderrChunks],
    });

    this.args.onProcessExit?.({
      providerId: args.providerId,
      threadIds,
      code: args.code,
      expected,
      signal: args.signal,
      stderr: formatProviderStderr(args.providerProcess.stderrChunks),
    });
  }

  private isCurrentProviderProcess(
    args: Pick<ProviderProcessExitArgs, "providerId" | "providerProcess">,
  ): boolean {
    return this.processes.get(args.providerId) === args.providerProcess;
  }
}

/**
 * Whether a child process has terminated, covering both normal exits
 * (`exitCode`) and signal terminations (`signalCode`). Node reports a
 * signal-killed child with a null `exitCode` and a set `signalCode`.
 */
export function hasChildProcessExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function formatProviderStderr(stderrChunks: readonly string[]): string | null {
  const stderr = stderrChunks.join("\n").trim();
  if (stderr.length === 0) {
    return null;
  }
  return stderr.slice(-4000);
}

function consumeExpectedProviderProcessShutdown(
  providerProcess: RuntimeProviderProcess,
): boolean {
  // The process exits once, so any outstanding mark (from this or a concurrent
  // caller) makes the exit expected; clear them all.
  const expected = providerProcess.expectedShutdownTokens.size > 0;
  providerProcess.expectedShutdownTokens.clear();
  return expected;
}

interface ProviderProcessErrorArgs {
  err: Error;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
}

interface ProviderProcessExitArgs {
  code: number | null;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  signal: string | null;
}

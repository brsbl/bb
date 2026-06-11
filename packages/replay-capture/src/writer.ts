import {
  appendFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AgentRuntimeCaptureEntry,
  AgentRuntimeTranslatedThreadEventCaptureEntry,
} from "@bb/agent-runtime/capture";
import {
  getThreadEventScopeTurnId,
  type PromptInput,
  type ResolvedThreadExecutionOptions,
  type SubmissionMode,
  type ThreadEvent,
} from "@bb/domain";
import {
  DEFAULT_REPLAY_CAPTURE_MAX_CAPTURES,
  REPLAY_CAPTURE_SCHEMA_VERSION,
  REPLAY_CAPTURE_USER_INPUT_PREVIEW_MAX,
  createReplayCaptureId,
  createReplayCapturePlaceholderTurnId,
  isReplayCaptureId,
  replayCaptureDir,
  replayCaptureIndexPath,
  replayCaptureManifestPath,
  replayCaptureRoot,
  replayRawProviderCaptureEntrySchema,
  replayRawProviderEventsPath,
  type ReplayCaptureKind,
  type ReplayCaptureManifest,
  type ReplayRawProviderCaptureEntry,
  type ReplayRawProviderEventRecord,
} from "./index.js";

function describePromptInput(item: PromptInput): string {
  switch (item.type) {
    case "text":
      return item.text;
    case "image":
      return "[image]";
    case "localImage":
      return `[image: ${path.basename(item.path)}]`;
    case "localFile":
      return `[file: ${item.name ?? path.basename(item.path)}]`;
  }
}

export function deriveReplayCaptureUserInputPreview(
  input: readonly PromptInput[],
): string {
  const joined = input
    .map(describePromptInput)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (joined.length <= REPLAY_CAPTURE_USER_INPUT_PREVIEW_MAX) {
    return joined;
  }
  const sliced = joined.slice(0, REPLAY_CAPTURE_USER_INPUT_PREVIEW_MAX);
  const lastSpace = sliced.lastIndexOf(" ");
  const truncated =
    lastSpace > REPLAY_CAPTURE_USER_INPUT_PREVIEW_MAX / 2
      ? sliced.slice(0, lastSpace)
      : sliced;
  return `${truncated}…`;
}

export interface ReplayCaptureLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

interface ErrorSummary {
  errorMessage: string;
  errorName: string;
}

type LoggableError = unknown;

function summarizeError(error: LoggableError): ErrorSummary {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name,
    };
  }

  return {
    errorMessage: String(error),
    errorName: "NonError",
  };
}

export interface ReplayCaptureThreadMetadata {
  environmentId: string;
  projectId: string;
  providerId: string;
  threadId: string;
  title: string | null;
}

export interface ReplayThreadEventInput {
  createdAt?: number;
  environmentId: string;
  event: ThreadEvent;
  threadId: string;
}

export interface ReplayTurnRequestInput {
  kind: ReplayCaptureKind;
  input: PromptInput[];
  execution: ResolvedThreadExecutionOptions;
  submissionMode: SubmissionMode;
  threadId: string;
}

interface ActiveCapture {
  captureId: string;
  dir: string;
  finalizedAt: number | null;
  finalized: boolean;
  manifest: ReplayCaptureManifest;
  pendingWrites: Promise<void>;
  pruned: boolean;
  rawProviderBytes: number;
  rawProviderEvents: number;
  rawProviderRecordWriteState: ReplayRawProviderEventRecordWriteState;
  rawCaptureIds: Set<string>;
  threadId: string;
}

export interface ReplayCaptureServiceOptions {
  dataDir: string;
  enabled: boolean;
  finalizedCaptureGraceMs?: number;
  logger: ReplayCaptureLogger;
  maxCaptureFileBytes?: number;
  maxCaptures?: number;
  now?: () => number;
}

export interface ReplayCaptureService {
  drain(): Promise<void>;
  recordRuntimeCaptureEntry(entry: AgentRuntimeCaptureEntry): void;
  recordThreadEvent(input: ReplayThreadEventInput): void;
  recordThreadMetadata(metadata: ReplayCaptureThreadMetadata): void;
  recordTurnRequest(input: ReplayTurnRequestInput): void;
}

export type ReplayRawProviderEventRecordSource =
  | AsyncIterable<ReplayRawProviderEventRecord>
  | Iterable<ReplayRawProviderEventRecord>;

export interface WriteFixtureArgs {
  /** Caller-resolved fixture directory; containment belongs to the corpus boundary. */
  destinationDir: string;
  manifest: ReplayCaptureManifest;
  rawProviderEventRecords: ReplayRawProviderEventRecordSource;
}

interface FixtureTempFiles {
  manifestTempPath: string;
  rawProviderEventsTempPath: string;
}

export interface ReplayRawProviderEventRecordWriteState {
  expectedOrdinal: number;
  previousRelativeMs: number;
}

export interface SerializedReplayRawProviderEventRecord {
  line: string;
  nextState: ReplayRawProviderEventRecordWriteState;
}

export interface SerializeReplayRawProviderEventRecordArgs {
  record: ReplayRawProviderEventRecord;
  state: ReplayRawProviderEventRecordWriteState;
}

function createRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

const DEFAULT_REPLAY_CAPTURE_MAX_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_FINALIZED_CAPTURE_GRACE_MS = 5_000;

function getProviderThreadId(event: ThreadEvent): string | null {
  return "providerThreadId" in event ? (event.providerThreadId ?? null) : null;
}

function shouldFinalizeCapture(event: ThreadEvent): boolean {
  switch (event.type) {
    case "turn/completed":
      return true;
    default:
      return false;
  }
}

function updateManifestEventCounts(capture: ActiveCapture): void {
  capture.manifest.eventCounts = {
    ...capture.manifest.eventCounts,
    rawProviderEvents: capture.rawProviderEvents,
  };
}

function updateManifestFromMetadata(
  manifest: ReplayCaptureManifest,
  metadata: ReplayCaptureThreadMetadata,
): ReplayCaptureManifest {
  return {
    ...manifest,
    environmentId: metadata.environmentId,
    projectId: metadata.projectId,
    providerId: metadata.providerId,
    threadId: metadata.threadId,
    title: metadata.title,
  };
}

async function pathMtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

export function createReplayRawProviderEventRecordWriteState(): ReplayRawProviderEventRecordWriteState {
  return {
    expectedOrdinal: 1,
    previousRelativeMs: 0,
  };
}

export function serializeReplayRawProviderEventRecord(
  args: SerializeReplayRawProviderEventRecordArgs,
): SerializedReplayRawProviderEventRecord {
  if (args.record.ordinal !== args.state.expectedOrdinal) {
    throw new Error(
      `Replay fixture raw provider event ordinal ${args.record.ordinal} did not match expected ordinal ${args.state.expectedOrdinal}`,
    );
  }
  if (args.record.relativeMs < args.state.previousRelativeMs) {
    throw new Error(
      `Replay fixture raw provider event relativeMs ${args.record.relativeMs} decreased below previous relativeMs ${args.state.previousRelativeMs}`,
    );
  }

  return {
    line: `${JSON.stringify(args.record)}\n`,
    nextState: {
      expectedOrdinal: args.state.expectedOrdinal + 1,
      previousRelativeMs: args.record.relativeMs,
    },
  };
}

export function commitReplayRawProviderEventRecordWriteState(
  state: ReplayRawProviderEventRecordWriteState,
  nextState: ReplayRawProviderEventRecordWriteState,
): void {
  state.expectedOrdinal = nextState.expectedOrdinal;
  state.previousRelativeMs = nextState.previousRelativeMs;
}

export function serializeReplayRawProviderEventRecords(
  records: Iterable<ReplayRawProviderEventRecord>,
): string {
  const state = createReplayRawProviderEventRecordWriteState();
  const lines: string[] = [];
  for (const record of records) {
    const serialized = serializeReplayRawProviderEventRecord({
      record,
      state,
    });
    lines.push(serialized.line);
    commitReplayRawProviderEventRecordWriteState(state, serialized.nextState);
  }
  return lines.join("");
}

async function removeFixtureTempFiles(args: FixtureTempFiles): Promise<void> {
  await Promise.all([
    rm(args.manifestTempPath, { force: true, recursive: true }),
    rm(args.rawProviderEventsTempPath, { force: true, recursive: true }),
  ]);
}

export async function writeFixture(args: WriteFixtureArgs): Promise<void> {
  await mkdir(args.destinationDir, { recursive: true });

  const manifestPath = path.join(args.destinationDir, "manifest.json");
  const rawProviderEventsPath = path.join(
    args.destinationDir,
    "raw-provider-events.ndjson",
  );
  const manifestTempPath = `${manifestPath}.tmp`;
  const rawProviderEventsTempPath = `${rawProviderEventsPath}.tmp`;
  let rawProviderEventsRenamed = false;

  try {
    await writeFile(rawProviderEventsTempPath, "");
    const state = createReplayRawProviderEventRecordWriteState();
    for await (const record of args.rawProviderEventRecords) {
      const serialized = serializeReplayRawProviderEventRecord({
        record,
        state,
      });
      await appendFile(rawProviderEventsTempPath, serialized.line);
      commitReplayRawProviderEventRecordWriteState(state, serialized.nextState);
    }
    await writeFile(manifestTempPath, JSON.stringify(args.manifest, null, 2));
    await rename(rawProviderEventsTempPath, rawProviderEventsPath);
    rawProviderEventsRenamed = true;
    await rename(manifestTempPath, manifestPath);
  } catch (error) {
    await removeFixtureTempFiles({
      manifestTempPath,
      rawProviderEventsTempPath,
    });
    if (rawProviderEventsRenamed) {
      await rm(rawProviderEventsPath, { force: true, recursive: true });
    }
    throw error;
  }
}

export function createReplayCaptureService(
  options: ReplayCaptureServiceOptions,
): ReplayCaptureService | null {
  if (!options.enabled) {
    return null;
  }

  const maxCaptures =
    options.maxCaptures ?? DEFAULT_REPLAY_CAPTURE_MAX_CAPTURES;
  const maxCaptureFileBytes =
    options.maxCaptureFileBytes ?? DEFAULT_REPLAY_CAPTURE_MAX_FILE_BYTES;
  const finalizedCaptureGraceMs =
    options.finalizedCaptureGraceMs ?? DEFAULT_FINALIZED_CAPTURE_GRACE_MS;
  const now = options.now ?? Date.now;
  const metadataByThreadId = new Map<string, ReplayCaptureThreadMetadata>();
  const pendingTurnRequestByThreadId = new Map<
    string,
    ReplayTurnRequestInput
  >();
  const activeByThreadId = new Map<string, ActiveCapture>();
  const allCapturesById = new Map<string, ActiveCapture>();
  const latestCaptureByThreadId = new Map<string, ActiveCapture>();
  const pendingRawByCaptureId = new Map<
    string,
    ReplayRawProviderCaptureEntry
  >();

  function scheduleCaptureWrite(
    capture: ActiveCapture,
    label: string,
    write: () => Promise<void>,
  ): void {
    capture.pendingWrites = capture.pendingWrites
      .then(async () => {
        if (capture.pruned) {
          return;
        }
        await write();
      })
      .catch(async (error: unknown) => {
        if (capture.pruned) {
          return;
        }
        capture.manifest.eventCounts.droppedRecords += 1;
        capture.manifest.errorMessage =
          error instanceof Error ? error.message : String(error);
        options.logger.warn(
          { captureId: capture.captureId, label, ...summarizeError(error) },
          "failed to write replay capture record",
        );
        try {
          await writeManifest(capture);
        } catch (manifestError) {
          options.logger.warn(
            { captureId: capture.captureId, ...summarizeError(manifestError) },
            "failed to write replay capture failure state",
          );
        }
      });
  }

  async function writeManifest(capture: ActiveCapture): Promise<void> {
    updateManifestEventCounts(capture);
    const manifestPath = replayCaptureManifestPath(
      options.dataDir,
      capture.captureId,
    );
    const tempPath = `${manifestPath}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(capture.manifest, null, 2));
      await rename(tempPath, manifestPath);
    } catch (error) {
      await rm(tempPath, { force: true, recursive: true });
      throw error;
    }
  }

  function getMetadata(threadId: string): ReplayCaptureThreadMetadata | null {
    return metadataByThreadId.get(threadId) ?? null;
  }

  function finalizedCaptureInGrace(capture: ActiveCapture): boolean {
    return (
      capture.finalizedAt !== null &&
      now() - capture.finalizedAt < finalizedCaptureGraceMs
    );
  }

  function scheduleFinalizedCaptureEviction(capture: ActiveCapture): void {
    if (finalizedCaptureGraceMs <= 0) {
      activeByThreadId.delete(capture.threadId);
      return;
    }
    const timeout = setTimeout(() => {
      if (
        activeByThreadId.get(capture.threadId) === capture &&
        capture.finalized
      ) {
        activeByThreadId.delete(capture.threadId);
      }
    }, finalizedCaptureGraceMs);
    timeout.unref();
  }

  function startsNewTurn(event: ThreadEvent): boolean {
    switch (event.type) {
      case "client/turn/start":
      case "turn/started":
        return true;
      default:
        return false;
    }
  }

  function getOrCreateCapture(
    threadId: string,
    event: ThreadEvent,
  ): ActiveCapture | null {
    const existing = activeByThreadId.get(threadId);
    if (existing) {
      if (!existing.finalized) {
        return existing;
      }
      if (!startsNewTurn(event)) {
        return finalizedCaptureInGrace(existing) ? existing : null;
      }
      activeByThreadId.delete(threadId);
    }

    const latest = latestCaptureByThreadId.get(threadId);
    if (latest?.finalized && !latest.pruned && !startsNewTurn(event)) {
      return finalizedCaptureInGrace(latest) ? latest : null;
    }

    const capturedAt = now();
    const captureId = createReplayCaptureId(capturedAt, createRandomSuffix());
    const metadata = getMetadata(threadId);
    if (!metadata) {
      options.logger.warn(
        { threadId },
        "skipping replay capture event without thread metadata",
      );
      return null;
    }
    const turnRequest = pendingTurnRequestByThreadId.get(threadId);
    if (!turnRequest) {
      options.logger.warn(
        { threadId },
        "skipping replay capture event without buffered turn request",
      );
      return null;
    }
    pendingTurnRequestByThreadId.delete(threadId);
    const capture: ActiveCapture = {
      captureId,
      dir: replayCaptureDir(options.dataDir, captureId),
      finalizedAt: null,
      finalized: false,
      manifest: {
        schemaVersion: REPLAY_CAPTURE_SCHEMA_VERSION,
        captureId,
        capturedAt,
        completedAt: null,
        source: "live-dev-capture",
        providerId: metadata.providerId,
        projectId: metadata.projectId,
        environmentId: metadata.environmentId,
        threadId: metadata.threadId,
        providerThreadId: null,
        title: metadata.title,
        kind: turnRequest.kind,
        turns: [
          {
            turnId: createReplayCapturePlaceholderTurnId(captureId),
            userInput: turnRequest.input,
            createdAt: capturedAt,
          },
        ],
        userInputPreview: deriveReplayCaptureUserInputPreview(
          turnRequest.input,
        ),
        submissionMode: turnRequest.submissionMode,
        execution: turnRequest.execution,
        eventCounts: {
          rawProviderEvents: 0,
          droppedRecords: 0,
        },
        errorMessage: null,
      },
      pendingWrites: Promise.resolve(),
      pruned: false,
      rawProviderBytes: 0,
      rawProviderEvents: 0,
      rawProviderRecordWriteState:
        createReplayRawProviderEventRecordWriteState(),
      rawCaptureIds: new Set<string>(),
      threadId,
    };
    activeByThreadId.set(threadId, capture);
    allCapturesById.set(captureId, capture);
    latestCaptureByThreadId.set(threadId, capture);
    scheduleCaptureWrite(capture, "initialize", async () => {
      await mkdir(capture.dir, { recursive: true });
      await writeFile(
        replayRawProviderEventsPath(options.dataDir, capture.captureId),
        "",
      );
      await writeManifest(capture);
    });
    return capture;
  }

  function scheduleRawProviderEventAppend(
    capture: ActiveCapture,
    entry: ReplayRawProviderCaptureEntry,
  ): void {
    scheduleCaptureWrite(capture, "append", async () => {
      const record: ReplayRawProviderEventRecord = {
        ordinal: capture.rawProviderRecordWriteState.expectedOrdinal,
        relativeMs: Math.max(0, entry.capturedAt - capture.manifest.capturedAt),
        entry,
      };
      const serialized = serializeReplayRawProviderEventRecord({
        record,
        state: capture.rawProviderRecordWriteState,
      });
      const nextBytes =
        capture.rawProviderBytes + Buffer.byteLength(serialized.line, "utf8");
      if (nextBytes > maxCaptureFileBytes) {
        capture.manifest.eventCounts.droppedRecords += 1;
        await writeManifest(capture);
        return;
      }

      await appendFile(
        replayRawProviderEventsPath(options.dataDir, capture.captureId),
        serialized.line,
      );
      commitReplayRawProviderEventRecordWriteState(
        capture.rawProviderRecordWriteState,
        serialized.nextState,
      );
      capture.rawProviderBytes = nextBytes;
      capture.rawProviderEvents += 1;
    });
  }

  function updateTurnId(capture: ActiveCapture, event: ThreadEvent): void {
    const turnId = getThreadEventScopeTurnId(event.scope);
    if (!turnId) {
      return;
    }
    const firstTurn = capture.manifest.turns[0];
    if (!firstTurn) {
      return;
    }
    if (firstTurn.turnId === turnId) {
      return;
    }
    const placeholderTurnId = createReplayCapturePlaceholderTurnId(
      capture.captureId,
    );
    if (firstTurn.turnId !== placeholderTurnId) {
      options.logger.warn(
        {
          captureId: capture.captureId,
          currentTurnId: firstTurn.turnId,
          incomingTurnId: turnId,
        },
        "ignoring mismatched replay capture turn id",
      );
      return;
    }
    // Live captures are single-turn. The placeholder exists only until the
    // first translated provider event carries the server turn id.
    capture.manifest.turns = [{ ...firstTurn, turnId }];
  }

  function updateProviderThreadId(
    capture: ActiveCapture,
    event: ThreadEvent,
  ): void {
    const providerThreadId = getProviderThreadId(event);
    if (providerThreadId) {
      capture.manifest.providerThreadId = providerThreadId;
    }
  }

  function recordRawForCapture(
    capture: ActiveCapture,
    entry: ReplayRawProviderCaptureEntry,
  ): void {
    if (capture.rawCaptureIds.has(entry.captureId)) {
      return;
    }
    capture.rawCaptureIds.add(entry.captureId);
    scheduleRawProviderEventAppend(capture, entry);
  }

  function dropPendingRawForCapture(capture: ActiveCapture): void {
    for (const rawCaptureId of capture.rawCaptureIds) {
      pendingRawByCaptureId.delete(rawCaptureId);
    }

    const providerThreadId = capture.manifest.providerThreadId;
    if (!providerThreadId) {
      return;
    }

    for (const [rawCaptureId, entry] of pendingRawByCaptureId) {
      if (entry.sourceThreadId === providerThreadId) {
        pendingRawByCaptureId.delete(rawCaptureId);
      }
    }
  }

  function recordTranslatedCaptureEntry(
    entry: AgentRuntimeTranslatedThreadEventCaptureEntry,
  ): void {
    const capture = getOrCreateCapture(entry.event.threadId, entry.event);
    if (!capture) {
      if (entry.rawCaptureId) {
        pendingRawByCaptureId.delete(entry.rawCaptureId);
      }
      return;
    }
    updateTurnId(capture, entry.event);
    updateProviderThreadId(capture, entry.event);
    if (entry.rawCaptureId) {
      const pendingRaw = pendingRawByCaptureId.get(entry.rawCaptureId);
      if (pendingRaw) {
        recordRawForCapture(capture, pendingRaw);
        pendingRawByCaptureId.delete(entry.rawCaptureId);
      }
    }
    if (capture.finalized) {
      capture.manifest.completedAt = now();
      scheduleCaptureWrite(capture, "post-finalize", async () => {
        await writeManifest(capture);
      });
    }
  }

  function recordRuntimeCaptureEntry(entry: AgentRuntimeCaptureEntry): void {
    if (entry.kind === "raw-provider-event") {
      const parsedEntry = replayRawProviderCaptureEntrySchema.safeParse(entry);
      if (!parsedEntry.success) {
        options.logger.warn(
          { captureId: entry.captureId, ...summarizeError(parsedEntry.error) },
          "skipping invalid replay raw provider capture entry",
        );
        return;
      }
      pendingRawByCaptureId.set(parsedEntry.data.captureId, parsedEntry.data);
      return;
    }
    if (entry.kind === "translated-thread-event") {
      recordTranslatedCaptureEntry(entry);
    }
  }

  function finalizeCapture(capture: ActiveCapture): void {
    if (capture.finalized) {
      return;
    }
    capture.finalized = true;
    capture.finalizedAt = now();
    scheduleFinalizedCaptureEviction(capture);
    const metadata = metadataByThreadId.get(capture.threadId);
    if (metadata) {
      capture.manifest = updateManifestFromMetadata(capture.manifest, metadata);
    }
    capture.manifest.completedAt = capture.finalizedAt;
    dropPendingRawForCapture(capture);
    scheduleCaptureWrite(capture, "finalize", async () => {
      await writeManifest(capture);
      await appendFile(
        replayCaptureIndexPath(options.dataDir),
        `${JSON.stringify({
          captureId: capture.captureId,
          capturedAt: capture.manifest.capturedAt,
          projectId: capture.manifest.projectId,
          threadId: capture.manifest.threadId,
          providerId: capture.manifest.providerId,
          title: capture.manifest.title,
        })}\n`,
      );
      options.logger.info(
        {
          captureId: capture.captureId,
          threadId: capture.threadId,
        },
        `Replay capture saved (${capture.captureId}): http://localhost:5173/development-only/replay`,
      );
      await pruneOldCaptures();
    });
  }

  function recordThreadEvent(input: ReplayThreadEventInput): void {
    const capture = getOrCreateCapture(input.threadId, input.event);
    if (!capture) {
      return;
    }
    const eventCapturedAt = input.createdAt ?? now();
    updateTurnId(capture, input.event);
    updateProviderThreadId(capture, input.event);
    if (capture.finalized) {
      capture.manifest.completedAt = eventCapturedAt;
      scheduleCaptureWrite(capture, "post-finalize", async () => {
        await writeManifest(capture);
      });
      return;
    }
    if (shouldFinalizeCapture(input.event)) {
      finalizeCapture(capture);
    }
  }

  function recordTurnRequest(input: ReplayTurnRequestInput): void {
    pendingTurnRequestByThreadId.set(input.threadId, input);
  }

  function recordThreadMetadata(metadata: ReplayCaptureThreadMetadata): void {
    metadataByThreadId.set(metadata.threadId, metadata);
    const capture =
      activeByThreadId.get(metadata.threadId) ??
      latestCaptureByThreadId.get(metadata.threadId);
    if (capture && !capture.pruned) {
      capture.manifest = updateManifestFromMetadata(capture.manifest, metadata);
      scheduleCaptureWrite(capture, "metadata", async () => {
        await writeManifest(capture);
      });
    }
  }

  function forgetPrunedCapture(capture: ActiveCapture): void {
    capture.pruned = true;
    allCapturesById.delete(capture.captureId);
    activeByThreadId.delete(capture.threadId);
    if (latestCaptureByThreadId.get(capture.threadId) === capture) {
      latestCaptureByThreadId.delete(capture.threadId);
      metadataByThreadId.delete(capture.threadId);
    }
    dropPendingRawForCapture(capture);
  }

  async function pruneOldCaptures(): Promise<void> {
    if (maxCaptures <= 0) {
      return;
    }
    for (const [threadId, capture] of activeByThreadId) {
      if (capture.finalized && !finalizedCaptureInGrace(capture)) {
        activeByThreadId.delete(threadId);
      }
    }
    let entries: string[];
    try {
      entries = await readdir(replayCaptureRoot(options.dataDir));
    } catch {
      return;
    }
    const activeCaptureIds = new Set(
      [...activeByThreadId.values()].map((capture) => capture.captureId),
    );
    const captureEntries = await Promise.all(
      entries
        .filter(isReplayCaptureId)
        .filter((captureId) => !activeCaptureIds.has(captureId))
        .map(async (captureId) => ({
          captureId,
          mtimeMs: await pathMtimeMs(
            replayCaptureDir(options.dataDir, captureId),
          ),
        })),
    );
    const staleCaptures = captureEntries
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(maxCaptures);
    for (const stale of staleCaptures) {
      await rm(replayCaptureDir(options.dataDir, stale.captureId), {
        force: true,
        recursive: true,
      });
      const capture = allCapturesById.get(stale.captureId);
      if (capture) {
        forgetPrunedCapture(capture);
      }
    }
  }

  void mkdir(replayCaptureRoot(options.dataDir), { recursive: true }).catch(
    (error) => {
      options.logger.warn(
        summarizeError(error),
        "failed to create replay capture root",
      );
    },
  );

  async function drain(): Promise<void> {
    await Promise.all(
      [...allCapturesById.values()].map((capture) => capture.pendingWrites),
    );
  }

  return {
    drain,
    recordRuntimeCaptureEntry,
    recordThreadEvent,
    recordThreadMetadata,
    recordTurnRequest,
  };
}

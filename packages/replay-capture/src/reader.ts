import { createReadStream, readFileSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  REPLAY_CAPTURE_SCHEMA_VERSION,
  isReplayCaptureId,
  replayCaptureDir,
  replayCaptureManifestPath,
  replayCaptureManifestSchema,
  replayCaptureRoot,
  replayRawProviderEventsPath,
  replayRawProviderEventRecordSchema,
  type ReplayCaptureManifest,
  type ReplayCaptureSummary,
  type ReplayRawProviderEventRecord,
} from "./index.js";

export type ReplayCaptureReadErrorCode =
  | "invalid_replay_capture"
  | "replay_capture_not_found";

export class ReplayCaptureReadError extends Error {
  constructor(
    readonly code: ReplayCaptureReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReplayCaptureReadError";
  }
}

export interface ReplayCaptureReadArgs {
  captureId: string;
  dataDir: string;
}

export interface ReplayManifestReadArgs<TManifest> {
  manifestPath: string;
  schema: z.ZodType<TManifest>;
}

export interface ReplayRawProviderRecordsFileReadArgs {
  filePath: string;
}

interface ParseManifestArgs<TManifest> {
  label: string;
  schema: z.ZodType<TManifest>;
  value: unknown;
}

interface StreamNdjsonRecordsArgs<
  TRecord extends { ordinal: number; relativeMs: number },
> {
  filePath: string;
  parse: (value: unknown) => TRecord;
}

interface NdjsonRecordValidationState {
  expectedOrdinal: number;
  previousRelativeMs: number;
}

interface ParseNdjsonRecordLineArgs<
  TRecord extends { ordinal: number; relativeMs: number },
> {
  line: string;
  lineNumber: number;
  parse: (value: unknown) => TRecord;
  state: NdjsonRecordValidationState;
}

const replayManifestVersionSchema = z
  .object({
    schemaVersion: z.number().int().optional(),
  })
  .passthrough();

function isNodeError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error && "code" in error && typeof error.code === "string"
  );
}

function requireCaptureId(captureId: string): void {
  if (!isReplayCaptureId(captureId)) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      "Invalid replay capture id",
    );
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new ReplayCaptureReadError(
      "replay_capture_not_found",
      `Replay capture file not found: ${filePath}`,
    );
  }
}

function readTextSync(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    throw new ReplayCaptureReadError(
      "replay_capture_not_found",
      `Replay capture file not found: ${filePath}`,
    );
  }
}

async function pathIsDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export async function requireReplayCaptureFile(
  filePath: string,
): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    throw new ReplayCaptureReadError(
      "replay_capture_not_found",
      `Replay capture file not found: ${filePath}`,
    );
  }
}

function parseJsonText(content: string, label: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      `Invalid replay capture JSON: ${label}`,
    );
  }
}

function parseJsonLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      `Invalid replay capture JSON on line ${lineNumber}`,
    );
  }
}

function createNdjsonRecordValidationState(): NdjsonRecordValidationState {
  return {
    expectedOrdinal: 1,
    previousRelativeMs: 0,
  };
}

function parseNdjsonRecordLine<
  TRecord extends { ordinal: number; relativeMs: number },
>(args: ParseNdjsonRecordLineArgs<TRecord>): TRecord | null {
  if (args.line.trim().length === 0) {
    return null;
  }

  const record = args.parse(parseJsonLine(args.line, args.lineNumber));
  if (record.ordinal !== args.state.expectedOrdinal) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      `Replay capture ordinal ${record.ordinal} did not match expected ordinal ${args.state.expectedOrdinal}`,
    );
  }
  if (record.relativeMs < args.state.previousRelativeMs) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      `Replay capture relativeMs decreased at record ${args.lineNumber}`,
    );
  }

  args.state.expectedOrdinal += 1;
  args.state.previousRelativeMs = record.relativeMs;
  return record;
}

async function* streamNdjsonRecords<
  TRecord extends { ordinal: number; relativeMs: number },
>(
  args: StreamNdjsonRecordsArgs<TRecord>,
): AsyncGenerator<TRecord> {
  const lines = createInterface({
    input: createReadStream(args.filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  const state = createNdjsonRecordValidationState();

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const record = parseNdjsonRecordLine({
        line,
        lineNumber,
        parse: args.parse,
        state,
      });
      if (!record) continue;
      yield record;
    }
  } catch (error) {
    if (error instanceof ReplayCaptureReadError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ReplayCaptureReadError(
        "replay_capture_not_found",
        `Replay capture file not found: ${args.filePath}`,
      );
    }
    throw error;
  }
}

function readNdjsonRecords<TRecord extends { ordinal: number; relativeMs: number }>(
  args: StreamNdjsonRecordsArgs<TRecord>,
): TRecord[] {
  const content = readTextSync(args.filePath);
  const state = createNdjsonRecordValidationState();
  const records: TRecord[] = [];

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const record = parseNdjsonRecordLine({
      line,
      lineNumber,
      parse: args.parse,
      state,
    });
    if (!record) continue;
    records.push(record);
  }

  return records;
}

function manifestVersion(value: unknown): number | null {
  const result = replayManifestVersionSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  return result.data.schemaVersion ?? null;
}

function unsupportedManifestVersionMessage(version: number): string {
  if (version === 2) {
    return `Replay capture schema version 2 is no longer supported. Delete ~/.bb-dev/replays/ or re-capture with schema version ${REPLAY_CAPTURE_SCHEMA_VERSION}.`;
  }
  return `Replay capture schema version ${version} is not supported. Replay captures must use schema version ${REPLAY_CAPTURE_SCHEMA_VERSION}.`;
}

function parseManifest<TManifest>(args: ParseManifestArgs<TManifest>): TManifest {
  const version = manifestVersion(args.value);
  if (version !== null && version !== REPLAY_CAPTURE_SCHEMA_VERSION) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      unsupportedManifestVersionMessage(version),
    );
  }
  const result = args.schema.safeParse(args.value);
  if (!result.success) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      `Replay capture manifest is invalid: ${args.label}`,
    );
  }
  return result.data;
}

function parseRawProviderRecord(value: unknown): ReplayRawProviderEventRecord {
  const result = replayRawProviderEventRecordSchema.safeParse(value);
  if (!result.success) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      "Replay raw provider event record is invalid",
    );
  }
  return result.data;
}

export async function readReplayCaptureManifest(
  args: ReplayCaptureReadArgs,
): Promise<ReplayCaptureManifest> {
  requireCaptureId(args.captureId);
  const manifestPath = replayCaptureManifestPath(args.dataDir, args.captureId);
  return readManifest({
    manifestPath,
    schema: replayCaptureManifestSchema,
  });
}

export function readReplayCaptureManifestSync(
  args: ReplayCaptureReadArgs,
): ReplayCaptureManifest {
  requireCaptureId(args.captureId);
  const manifestPath = replayCaptureManifestPath(args.dataDir, args.captureId);
  return readManifestSync({
    manifestPath,
    schema: replayCaptureManifestSchema,
  });
}

export async function readManifest<TManifest>(
  args: ReplayManifestReadArgs<TManifest>,
): Promise<TManifest> {
  const content = await readText(args.manifestPath);
  return parseManifest({
    label: args.manifestPath,
    schema: args.schema,
    value: parseJsonText(content, args.manifestPath),
  });
}

export function readManifestSync<TManifest>(
  args: ReplayManifestReadArgs<TManifest>,
): TManifest {
  const content = readTextSync(args.manifestPath);
  return parseManifest({
    label: args.manifestPath,
    schema: args.schema,
    value: parseJsonText(content, args.manifestPath),
  });
}

function toSummary(manifest: ReplayCaptureManifest): ReplayCaptureSummary {
  return {
    captureId: manifest.captureId,
    capturedAt: manifest.capturedAt,
    completedAt: manifest.completedAt,
    providerId: manifest.providerId,
    projectId: manifest.projectId,
    environmentId: manifest.environmentId,
    threadId: manifest.threadId,
    title: manifest.title,
    kind: manifest.kind,
    userInputPreview: manifest.userInputPreview,
    submissionMode: manifest.submissionMode,
    execution: manifest.execution,
    eventCounts: manifest.eventCounts,
    errorMessage: manifest.errorMessage,
  };
}

export async function listReplayCaptureSummaries(
  dataDir: string,
): Promise<ReplayCaptureSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(replayCaptureRoot(dataDir));
  } catch {
    return [];
  }

  const captures: ReplayCaptureSummary[] = [];
  for (const entry of entries) {
    if (!isReplayCaptureId(entry)) {
      continue;
    }
    if (!(await pathIsDirectory(replayCaptureDir(dataDir, entry)))) {
      continue;
    }
    try {
      captures.push(
        toSummary(
          await readReplayCaptureManifest({
            captureId: entry,
            dataDir,
          }),
        ),
      );
    } catch {
      continue;
    }
  }

  return captures.sort((left, right) => right.capturedAt - left.capturedAt);
}

export async function* streamRawProviderRecords(
  args: ReplayCaptureReadArgs,
): AsyncGenerator<ReplayRawProviderEventRecord> {
  requireCaptureId(args.captureId);
  yield* streamNdjsonRecords({
    filePath: replayRawProviderEventsPath(args.dataDir, args.captureId),
    parse: parseRawProviderRecord,
  });
}

export function readRawProviderRecords(
  args: ReplayCaptureReadArgs,
): ReplayRawProviderEventRecord[] {
  requireCaptureId(args.captureId);
  return readRawProviderRecordsFile({
    filePath: replayRawProviderEventsPath(args.dataDir, args.captureId),
  });
}

export function readRawProviderRecordsFile(
  args: ReplayRawProviderRecordsFileReadArgs,
): ReplayRawProviderEventRecord[] {
  return readNdjsonRecords({
    filePath: args.filePath,
    parse: parseRawProviderRecord,
  });
}

export async function deleteReplayCapture(
  args: ReplayCaptureReadArgs,
): Promise<void> {
  requireCaptureId(args.captureId);
  const dir = replayCaptureDir(args.dataDir, args.captureId);
  if (!(await pathIsDirectory(dir))) {
    throw new ReplayCaptureReadError(
      "replay_capture_not_found",
      `Replay capture not found: ${args.captureId}`,
    );
  }
  await rm(dir, { force: true, recursive: true });
}

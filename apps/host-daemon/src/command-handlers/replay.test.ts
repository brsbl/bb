import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  requireThreadEventScopeTurnId,
} from "@bb/domain";
import type { HostDaemonOnlineRpcCommand } from "@bb/host-daemon-contract";
import {
  createReplayCaptureId,
  createReplayCapturePlaceholderTurnId,
  replayCaptureDir,
  replayCaptureManifestPath,
  replayCaptureRoot,
  replayRawProviderEventsPath,
  type ReplayCaptureManifest,
  type ReplayRawProviderEventRecord,
} from "@bb/replay-capture";
import type { EventSinkInput } from "../event-sink.js";
import type {
  EventSink,
  ReplayTaskRegistry,
} from "../command-dispatch-support.js";
import { getReplayCapture, listReplayCaptures, runReplay } from "./replay.js";

function threadStorageRoot(dataDir: string): string {
  return path.join(dataDir, "thread-storage");
}

function replayRequestId(value: number) {
  return encodeClientTurnRequestIdNumber({ value });
}

type ReplayRunCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "run" }
>;

function baseManifest(captureId: string): ReplayCaptureManifest {
  return {
    schemaVersion: 3,
    captureId,
    capturedAt: 1_000,
    completedAt: 1_100,
    source: "live-dev-capture",
    providerId: "codex",
    projectId: "proj-1",
    environmentId: "env-1",
    threadId: "thr-original",
    providerThreadId: "provider-thread-1",
    title: "Original",
    kind: "thread-start",
    turns: [
      {
        turnId: "turn-1",
        userInput: [{ type: "text", text: "Original prompt", mentions: [] }],
        createdAt: 1_000,
      },
    ],
    userInputPreview: "Original prompt",
    submissionMode: {
      planMode: "default",
      goalMode: "none",
    },
    execution: {
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    eventCounts: {
      rawProviderEvents: 0,
      droppedRecords: 0,
    },
    errorMessage: null,
  };
}

function captureEventSink(emitted: EventSinkInput[]): EventSink {
  return {
    emit: (event) => {
      emitted.push(event);
    },
    flush: async () => undefined,
  };
}

async function writeCaptureManifest(args: {
  dataDir: string;
  manifest: ReplayCaptureManifest;
}): Promise<void> {
  await mkdir(replayCaptureDir(args.dataDir, args.manifest.captureId), {
    recursive: true,
  });
  await writeFile(
    replayCaptureManifestPath(args.dataDir, args.manifest.captureId),
    JSON.stringify(args.manifest, null, 2),
  );
}

interface WriteRawProviderCaptureArgs {
  captureId: string;
  dataDir: string;
  records: ReplayRawProviderEventRecord[];
}

async function writeRawProviderCapture(
  args: WriteRawProviderCaptureArgs,
): Promise<void> {
  await mkdir(replayCaptureDir(args.dataDir, args.captureId), {
    recursive: true,
  });
  await writeFile(
    replayCaptureManifestPath(args.dataDir, args.captureId),
    JSON.stringify(
      {
        ...baseManifest(args.captureId),
        eventCounts: {
          rawProviderEvents: args.records.length,
          droppedRecords: 0,
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    replayRawProviderEventsPath(args.dataDir, args.captureId),
    args.records.map((record) => JSON.stringify(record)).join("\n"),
  );
}

function manifestWithPlaceholderTurnId(args: {
  captureId: string;
  rawProviderEvents: number;
}): ReplayCaptureManifest {
  const manifest = baseManifest(args.captureId);
  const firstTurn = manifest.turns[0];
  if (!firstTurn) {
    throw new Error("Expected base replay manifest to include a turn");
  }
  return {
    ...manifest,
    eventCounts: {
      rawProviderEvents: args.rawProviderEvents,
      droppedRecords: 0,
    },
    turns: [
      {
        ...firstTurn,
        turnId: createReplayCapturePlaceholderTurnId(args.captureId),
      },
    ],
  };
}

type RawProviderReplayMethod = "turn/started" | "turn/completed";

interface RawProviderAgentMessageDeltaRecordArgs {
  captureId: string;
  delta: string;
  itemId: string;
  ordinal: number;
  relativeMs: number;
}

function rawProviderRecord(args: {
  captureId: string;
  method: RawProviderReplayMethod;
  ordinal: number;
  relativeMs: number;
}): ReplayRawProviderEventRecord {
  const status = args.method === "turn/completed" ? "completed" : "inProgress";
  return {
    ordinal: args.ordinal,
    relativeMs: args.relativeMs,
    entry: {
      kind: "raw-provider-event",
      capturedAt: 1_000 + args.relativeMs,
      providerId: "codex",
      captureId: args.captureId,
      rawLine: "{}",
      rawEvent: {
        jsonrpc: "2.0",
        method: args.method,
        params: {
          threadId: "provider-thread-1",
          turn: {
            id: "turn-1",
            items: [],
            status,
            error: null,
          },
        },
      },
      sourceThreadId: "provider-thread-1",
    },
  };
}

function rawProviderAgentMessageDeltaRecord(
  args: RawProviderAgentMessageDeltaRecordArgs,
): ReplayRawProviderEventRecord {
  return {
    ordinal: args.ordinal,
    relativeMs: args.relativeMs,
    entry: {
      kind: "raw-provider-event",
      capturedAt: 1_000 + args.relativeMs,
      providerId: "codex",
      captureId: args.captureId,
      rawLine: "{}",
      rawEvent: {
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: {
          threadId: "provider-thread-1",
          turnId: "turn-1",
          itemId: args.itemId,
          delta: args.delta,
        },
      },
      sourceThreadId: "provider-thread-1",
    },
  };
}

function rawProviderThreadNameRecord(args: {
  captureId: string;
  ordinal: number;
  relativeMs: number;
  threadName: string;
}): ReplayRawProviderEventRecord {
  return {
    ordinal: args.ordinal,
    relativeMs: args.relativeMs,
    entry: {
      kind: "raw-provider-event",
      capturedAt: 1_000 + args.relativeMs,
      providerId: "codex",
      captureId: args.captureId,
      rawLine: "{}",
      rawEvent: {
        jsonrpc: "2.0",
        method: "thread/name/updated",
        params: {
          threadId: "provider-thread-1",
          threadName: args.threadName,
        },
      },
      sourceThreadId: "provider-thread-1",
    },
  };
}

describe("replay capture commands", () => {
  it("lists readable capture manifests from the daemon data dir", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-list-"));
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    const olderCaptureId = createReplayCaptureId(1_000, "abc123zz");
    const newerCaptureId = createReplayCaptureId(2_000, "def456zz");
    await writeCaptureManifest({
      dataDir,
      manifest: {
        ...baseManifest(olderCaptureId),
        capturedAt: 1_000,
      },
    });
    await writeCaptureManifest({
      dataDir,
      manifest: {
        ...baseManifest(newerCaptureId),
        capturedAt: 2_000,
      },
    });
    await mkdir(
      replayCaptureDir(dataDir, createReplayCaptureId(1_500, "bad000zz")),
      {
        recursive: true,
      },
    );
    await mkdir(path.join(replayCaptureRoot(dataDir), "not-a-capture"), {
      recursive: true,
    });

    const result = await listReplayCaptures({
      dataDir,
    });

    expect(result.captures.map((capture) => capture.captureId)).toEqual([
      newerCaptureId,
      olderCaptureId,
    ]);
  });

  it("loads capture detail from the daemon data dir", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-get-"));
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    const manifest = baseManifest(captureId);
    await writeCaptureManifest({ dataDir, manifest });

    const result = await getReplayCapture(
      {
        type: "development.replay",
        operation: "capture-get",
        captureId,
      },
      {
        dataDir,
      },
    );

    expect(result).toEqual(manifest);
  });

  it("rejects capture detail when the manifest schema is invalid", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-get-"));
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(replayCaptureDir(dataDir, captureId), { recursive: true });
    await writeFile(
      replayCaptureManifestPath(dataDir, captureId),
      JSON.stringify({
        ...baseManifest(captureId),
        // Force a schema mismatch by using a value the manifest schema rejects.
        schemaVersion: 999,
      }),
    );

    await expect(
      getReplayCapture(
        {
          type: "development.replay",
          operation: "capture-get",
          captureId,
        },
        {
          dataDir,
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_replay_capture",
      message:
        "Replay capture schema version 999 is not supported. Replay captures must use schema version 3.",
    });
  });
});

describe("runReplay", () => {
  it("replays raw provider records through translation with remapped thread ids", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-run-"));
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    await writeRawProviderCapture({
      captureId,
      dataDir,
      records: [
        rawProviderRecord({
          captureId: "raw-1",
          method: "turn/started",
          ordinal: 1,
          relativeMs: 0,
        }),
        rawProviderThreadNameRecord({
          captureId: "raw-title",
          ordinal: 2,
          relativeMs: 10,
          threadName: "[bb] Original title",
        }),
        rawProviderRecord({
          captureId: "raw-2",
          method: "turn/completed",
          ordinal: 3,
          relativeMs: 20,
        }),
      ],
    });

    const emitted: EventSinkInput[] = [];
    const command: ReplayRunCommand = {
      type: "development.replay",
      operation: "run",
      captureId,
      environmentId: "env-1",
      threadId: "thr-replay",
      requestId: replayRequestId(1),
      speed: 10,
    };
    const replayTasks: ReplayTaskRegistry = new Map();

    const result = await runReplay(command, {
      dataDir,
      eventSink: captureEventSink(emitted),
      replayTasks,
    });

    expect(result).toEqual({});
    await vi.waitFor(() => {
      expect(emitted.map((input) => input.event.type)).toEqual([
        "turn/started",
        "turn/input/accepted",
        "thread/name/updated",
        "turn/completed",
      ]);
    });
    expect(emitted.every((input) => input.threadId === "thr-replay")).toBe(
      true,
    );
    expect(
      emitted.every((input) => input.event.threadId === "thr-replay"),
    ).toBe(true);
    expect(
      emitted.every((input) =>
        "providerThreadId" in input.event
          ? input.event.providerThreadId === `replay:${captureId}`
          : true,
      ),
    ).toBe(true);
    expect(emitted[1]?.event).toMatchObject({
      type: "turn/input/accepted",
      clientRequestId: command.requestId,
    });
    expect(emitted[2]?.event).toMatchObject({
      type: "thread/name/updated",
      threadName: "[Replay] Original title",
    });
    await vi.waitFor(() => {
      expect(replayTasks.has("thr-replay")).toBe(false);
    });
  });

  it("returns before delayed replay events are emitted", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-run-"));
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    await writeRawProviderCapture({
      captureId,
      dataDir,
      records: [
        rawProviderRecord({
          captureId: "raw-1",
          method: "turn/started",
          ordinal: 1,
          relativeMs: 20,
        }),
      ],
    });

    const emitted: EventSinkInput[] = [];
    const replayTasks: ReplayTaskRegistry = new Map();
    const command: ReplayRunCommand = {
      type: "development.replay",
      operation: "run",
      captureId,
      environmentId: "env-1",
      threadId: "thr-replay",
      requestId: replayRequestId(2),
      speed: 1,
    };

    const result = await runReplay(command, {
      dataDir,
      eventSink: captureEventSink(emitted),
      replayTasks,
    });

    expect(result).toEqual({});
    expect(emitted).toHaveLength(0);
    const replayTask = replayTasks.get("thr-replay");
    expect(replayTask).toBeDefined();
    if (!replayTask) {
      throw new Error("Expected replay task to be tracked");
    }

    await replayTask.done;

    expect(emitted.map((input) => input.event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "turn/completed",
    ]);
    expect(replayTasks.has("thr-replay")).toBe(false);
  });

  it("emits an interrupted terminal event when a tracked replay is aborted", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-run-"));
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    await writeRawProviderCapture({
      captureId,
      dataDir,
      records: [
        rawProviderRecord({
          captureId: "raw-1",
          method: "turn/started",
          ordinal: 1,
          relativeMs: 1_000,
        }),
      ],
    });

    const emitted: EventSinkInput[] = [];
    const replayTasks: ReplayTaskRegistry = new Map();
    const command: ReplayRunCommand = {
      type: "development.replay",
      operation: "run",
      captureId,
      environmentId: "env-1",
      threadId: "thr-replay",
      requestId: replayRequestId(3),
      speed: 0.5,
    };

    vi.useFakeTimers();
    try {
      await expect(
        runReplay(command, {
          dataDir,
          eventSink: captureEventSink(emitted),
          replayTasks,
        }),
      ).resolves.toEqual({});

      const replayTask = replayTasks.get("thr-replay");
      expect(replayTask).toBeDefined();
      if (!replayTask) {
        throw new Error("Expected replay task to be tracked");
      }

      replayTask.abort.abort();
      await replayTask.done;

      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.event).toMatchObject({
        type: "turn/completed",
        status: "interrupted",
        threadId: "thr-replay",
      });
      expect(replayTasks.has("thr-replay")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the replayed turn id when aborting after turn start", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-run-"));
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    await writeRawProviderCapture({
      captureId,
      dataDir,
      records: [
        rawProviderRecord({
          captureId: "raw-1",
          method: "turn/started",
          ordinal: 1,
          relativeMs: 0,
        }),
        rawProviderRecord({
          captureId: "raw-2",
          method: "turn/completed",
          ordinal: 2,
          relativeMs: 10,
        }),
      ],
    });
    await writeCaptureManifest({
      dataDir,
      manifest: manifestWithPlaceholderTurnId({
        captureId,
        rawProviderEvents: 2,
      }),
    });

    const emitted: EventSinkInput[] = [];
    const replayTasks: ReplayTaskRegistry = new Map();
    const command: ReplayRunCommand = {
      type: "development.replay",
      operation: "run",
      captureId,
      environmentId: "env-1",
      threadId: "thr-replay",
      requestId: replayRequestId(5),
      speed: 1,
    };
    const eventSink: EventSink = {
      emit: (event) => {
        emitted.push(event);
        if (event.event.type === "turn/started") {
          replayTasks.get("thr-replay")?.abort.abort();
        }
      },
      flush: async () => undefined,
    };

    await expect(
      runReplay(command, {
        dataDir,
        eventSink,
        replayTasks,
      }),
    ).resolves.toEqual({});
    const replayTask = replayTasks.get("thr-replay");
    expect(replayTask).toBeDefined();
    if (!replayTask) {
      throw new Error("Expected replay task to be tracked");
    }
    await replayTask.done;

    expect(emitted.map((input) => input.event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "turn/completed",
    ]);
    const interruptedEvent = emitted[2]?.event;
    expect(interruptedEvent?.type).toBe("turn/completed");
    if (interruptedEvent?.type !== "turn/completed") {
      throw new Error("Expected interrupted replay terminal");
    }
    expect(interruptedEvent.status).toBe("interrupted");
    expect(
      requireThreadEventScopeTurnId({
        type: interruptedEvent.type,
        scope: interruptedEvent.scope,
      }),
    ).toBe("turn-1");
    expect(replayTasks.has("thr-replay")).toBe(false);
  });

  it("uses the replayed turn id when aborting after an in-turn event", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-run-"));
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    await writeRawProviderCapture({
      captureId,
      dataDir,
      records: [
        rawProviderRecord({
          captureId: "raw-1",
          method: "turn/started",
          ordinal: 1,
          relativeMs: 0,
        }),
        rawProviderAgentMessageDeltaRecord({
          captureId: "raw-delta",
          delta: "hello replay",
          itemId: "item-1",
          ordinal: 2,
          relativeMs: 10,
        }),
        rawProviderRecord({
          captureId: "raw-2",
          method: "turn/completed",
          ordinal: 3,
          relativeMs: 20,
        }),
      ],
    });
    await writeCaptureManifest({
      dataDir,
      manifest: manifestWithPlaceholderTurnId({
        captureId,
        rawProviderEvents: 3,
      }),
    });

    const emitted: EventSinkInput[] = [];
    const replayTasks: ReplayTaskRegistry = new Map();
    const command: ReplayRunCommand = {
      type: "development.replay",
      operation: "run",
      captureId,
      environmentId: "env-1",
      threadId: "thr-replay",
      requestId: replayRequestId(6),
      speed: 1,
    };
    const eventSink: EventSink = {
      emit: (event) => {
        emitted.push(event);
        if (event.event.type === "item/agentMessage/delta") {
          replayTasks.get("thr-replay")?.abort.abort();
        }
      },
      flush: async () => undefined,
    };

    await expect(
      runReplay(command, {
        dataDir,
        eventSink,
        replayTasks,
      }),
    ).resolves.toEqual({});
    const replayTask = replayTasks.get("thr-replay");
    expect(replayTask).toBeDefined();
    if (!replayTask) {
      throw new Error("Expected replay task to be tracked");
    }
    await replayTask.done;

    expect(emitted.map((input) => input.event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "item/agentMessage/delta",
      "turn/completed",
    ]);
    const interruptedEvent = emitted[3]?.event;
    expect(interruptedEvent?.type).toBe("turn/completed");
    if (interruptedEvent?.type !== "turn/completed") {
      throw new Error("Expected interrupted replay terminal");
    }
    expect(interruptedEvent.status).toBe("interrupted");
    expect(
      requireThreadEventScopeTurnId({
        type: interruptedEvent.type,
        scope: interruptedEvent.scope,
      }),
    ).toBe("turn-1");
    expect(replayTasks.has("thr-replay")).toBe(false);
  });

  it("rejects non-monotonic replay timing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-replay-run-"));
    const captureId = createReplayCaptureId(1_000, "abc123zz");
    await mkdir(threadStorageRoot(dataDir), { recursive: true });
    await writeRawProviderCapture({
      captureId,
      dataDir,
      records: [
        rawProviderRecord({
          captureId: "raw-1",
          method: "turn/started",
          ordinal: 1,
          relativeMs: 20,
        }),
        rawProviderRecord({
          captureId: "raw-2",
          method: "turn/completed",
          ordinal: 2,
          relativeMs: 10,
        }),
      ],
    });

    const command: ReplayRunCommand = {
      type: "development.replay",
      operation: "run",
      captureId,
      environmentId: "env-1",
      threadId: "thr-replay",
      requestId: replayRequestId(4),
      speed: 10,
    };
    const replayTasks: ReplayTaskRegistry = new Map();
    const emitted: EventSinkInput[] = [];

    await expect(
      runReplay(command, {
        dataDir,
        eventSink: captureEventSink(emitted),
        replayTasks,
      }),
    ).resolves.toEqual({});
    const replayTask = replayTasks.get("thr-replay");
    expect(replayTask).toBeDefined();
    if (!replayTask) {
      throw new Error("Expected replay task to be tracked");
    }
    await replayTask.done;

    expect(emitted.map((input) => input.event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "system/error",
      "turn/completed",
    ]);
    expect(emitted[1]?.event).toMatchObject({
      type: "turn/input/accepted",
      clientRequestId: command.requestId,
    });
    expect(emitted[2]?.event).toMatchObject({
      type: "system/error",
      message: "Replay capture relativeMs decreased at record 2",
    });
    expect(emitted[3]?.event).toMatchObject({
      type: "turn/completed",
      status: "failed",
    });
    expect(replayTasks.has("thr-replay")).toBe(false);
  });
});

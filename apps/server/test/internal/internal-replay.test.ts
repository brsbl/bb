import { listEvents } from "@bb/db";
import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import { replayRunResponseSchema } from "@bb/server-contract";
import {
  createReplayCaptureId,
  type ReplayCaptureManifest,
} from "@bb/replay-capture";
import { describe, expect, it } from "vitest";
import { parseStoredTurnRequestEvent } from "../../src/services/threads/thread-events.js";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface BuildReplayManifestArgs {
  captureId: string;
  environmentId: string;
  projectId: string;
  threadId: string;
}

interface RegisterReplaySocketArgs {
  harness: TestAppHarness;
  hostId: string;
  manifest: ReplayCaptureManifest;
  sessionId: string;
}

interface ReplayResultForRequestArgs {
  manifest: ReplayCaptureManifest;
  request: HostDaemonOnlineRpcRequestMessage;
}

interface ReplayTestSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

function buildReplayManifest(
  args: BuildReplayManifestArgs,
): ReplayCaptureManifest {
  return {
    schemaVersion: 3,
    captureId: args.captureId,
    capturedAt: 1_000,
    completedAt: 1_100,
    source: "live-dev-capture",
    providerId: "codex",
    projectId: args.projectId,
    environmentId: args.environmentId,
    threadId: args.threadId,
    providerThreadId: "provider-thread-original",
    title: "Original plan goal turn",
    kind: "turn-start",
    turns: [
      {
        turnId: "turn-original",
        userInput: [
          {
            type: "text",
            text: "Replay this planned goal turn",
            mentions: [],
          },
        ],
        createdAt: 1_000,
      },
    ],
    userInputPreview: "Replay this planned goal turn",
    submissionMode: {
      planMode: "plan",
      goalMode: "goal",
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

function replayResultForRequest(
  args: ReplayResultForRequestArgs,
): HostDaemonOnlineRpcResult {
  const { command } = args.request;
  if (command.type !== "development.replay") {
    throw new Error(`Unexpected command type ${command.type}`);
  }

  switch (command.operation) {
    case "capture-list":
      return { captures: [] };
    case "capture-get":
      expect(command.captureId).toBe(args.manifest.captureId);
      return args.manifest;
    case "capture-delete":
      return {};
    case "run":
      expect(command.captureId).toBe(args.manifest.captureId);
      return {};
  }
}

function replayOperationName(
  request: HostDaemonOnlineRpcRequestMessage,
): string {
  const { command } = request;
  if (command.type !== "development.replay") {
    return command.type;
  }
  return command.operation;
}

function registerReplaySocket(
  args: RegisterReplaySocketArgs,
): HostDaemonOnlineRpcRequestMessage[] {
  const requests: HostDaemonOnlineRpcRequestMessage[] = [];
  const socket: ReplayTestSocket = {
    close() {},
    send(data) {
      const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
      if (message.type !== "host-rpc.request") {
        return;
      }
      requests.push(message);
      args.harness.hub.recordHostOnlineRpcResponse({
        sessionId: args.sessionId,
        message: hostDaemonOnlineRpcResponseMessageSchema.parse({
          type: "host-rpc.response",
          requestId: message.requestId,
          commandType: message.command.type,
          ok: true,
          result: replayResultForRequest({
            manifest: args.manifest,
            request: message,
          }),
        }),
      });
    },
  };
  args.harness.hub.unregisterDaemon(args.sessionId);
  args.harness.hub.registerDaemon(args.sessionId, args.hostId, socket);
  return requests;
}

describe("development replay routes", () => {
  it("preserves captured submission mode on replayed turn requests", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, project, environment, thread } = seedThreadFixture(
        harness,
        {
          thread: { providerId: "codex", status: "idle" },
        },
      );
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const manifest = buildReplayManifest({
        captureId,
        environmentId: environment.id,
        projectId: project.id,
        threadId: thread.id,
      });
      const requests = registerReplaySocket({
        harness,
        hostId: host.id,
        manifest,
        sessionId: session.id,
      });

      const response = await harness.app.request(
        `/api/v1/development-only/replay/captures/${captureId}/runs`,
        {
          method: "POST",
          body: JSON.stringify({ speed: 1 }),
          headers: { "content-type": "application/json" },
        },
      );

      expect(response.status).toBe(201);
      const body = replayRunResponseSchema.parse(await readJson(response));
      const requestRows = listEvents(harness.db, {
        threadId: body.replayThreadId,
      }).filter((row) => row.type === "client/turn/requested");
      expect(requestRows).toHaveLength(1);
      const requestRow = requestRows[0];
      expect(requestRow).toBeDefined();
      if (!requestRow) {
        return;
      }

      const turnRequest = parseStoredTurnRequestEvent(requestRow);
      expect(turnRequest.submissionMode).toEqual(manifest.submissionMode);
      expect(requests.map(replayOperationName)).toEqual(["capture-get", "run"]);
    });
  });
});

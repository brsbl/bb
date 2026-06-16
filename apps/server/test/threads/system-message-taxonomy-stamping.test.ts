import { and, eq } from "drizzle-orm";
import {
  setWorkflowRunPendingManagerNotification,
  settleWorkflowRunInTransaction,
} from "@bb/db/internal-lifecycle";
import { events } from "@bb/db";
import {
  turnRequestEventDataSchema,
  type SystemMessageKind,
  type SystemMessageSubject,
  type ThreadEventTurnStatus,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  queueChildThreadNeedsAttentionNotificationBestEffort,
  queueChildThreadTurnNotificationBestEffort,
} from "../../src/services/threads/child-thread-notifications.js";
import { handleThreadOwnershipChange } from "../../src/services/threads/thread-ownership.js";
import { runWorkflowRunPendingNotificationSweep } from "../../src/services/workflows/workflow-run-pending-notifications.js";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  createRun,
  forceRunStatus,
  startRunToRunning,
  ZERO_USAGE,
} from "../helpers/workflow-runs.js";
import {
  createTestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

interface ParentFixture {
  environmentId: string;
  hostId: string;
  parentThreadId: string;
  projectId: string;
}

// A parent/manager thread that can receive a `[bb system]` turn: a ready
// environment plus runtime state (provider thread id) so the dispatch resolves
// to a `turn.submit`.
function seedParentFixture(
  harness: TestHarness,
  hostId: string,
): ParentFixture {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/${hostId}-environment`,
  });
  const parent = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    title: "Manager",
  });
  seedThreadRuntimeState(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: `provider-${hostId}`,
    inputText: "Manage things",
    model: "fake-model",
  });
  return {
    environmentId: environment.id,
    hostId: host.id,
    parentThreadId: parent.id,
    projectId: project.id,
  };
}

interface StampedSystemMessage {
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

async function waitForStampedSystemMessage(
  harness: TestHarness,
  parentThreadId: string,
  timeoutMs = 4_000,
): Promise<StampedSystemMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = harness.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.threadId, parentThreadId),
          eq(events.type, "client/turn/requested"),
        ),
      )
      .orderBy(events.sequence)
      .all();
    for (const row of rows) {
      const data = turnRequestEventDataSchema.parse(JSON.parse(row.data));
      if (data.initiator === "system") {
        return {
          systemMessageKind: data.systemMessageKind ?? "unlabeled",
          systemMessageSubject: data.systemMessageSubject ?? null,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for a stamped system message");
}

describe("Family B emit-site discriminator stamping", () => {
  const childTurnStatuses: ReadonlyArray<{
    turnStatus: ThreadEventTurnStatus;
    expectedKind: SystemMessageKind;
  }> = [
    { turnStatus: "completed", expectedKind: "child-completed" },
    { turnStatus: "failed", expectedKind: "child-failed" },
    { turnStatus: "interrupted", expectedKind: "child-interrupted" },
  ];

  for (const { turnStatus, expectedKind } of childTurnStatuses) {
    it(`stamps a single ${turnStatus} child outcome as ${expectedKind}`, async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedParentFixture(harness, `host-child-${turnStatus}`);
        const child = seedThread(harness.deps, {
          projectId: fixture.projectId,
          title: "Worker child",
          parentThreadId: fixture.parentThreadId,
        });

        await queueChildThreadTurnNotificationBestEffort(harness.deps, {
          childThread: child,
          parentThreadId: fixture.parentThreadId,
          turnStatus,
        });

        const stamped = await waitForStampedSystemMessage(
          harness,
          fixture.parentThreadId,
        );
        expect(stamped.systemMessageKind).toBe(expectedKind);
        expect(stamped.systemMessageSubject).toEqual({
          kind: "thread",
          threadId: child.id,
          threadName: "Worker child",
        });
      });
    });
  }

  it("stamps a multi-child batch as child-outcome-batch with a count subject", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedParentFixture(harness, "host-child-batch");
      const childA = seedThread(harness.deps, {
        projectId: fixture.projectId,
        title: "Worker A",
        parentThreadId: fixture.parentThreadId,
      });
      const childB = seedThread(harness.deps, {
        projectId: fixture.projectId,
        title: "Worker B",
        parentThreadId: fixture.parentThreadId,
      });

      // Both queued within the batch window collapse into one batch message.
      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        childThread: childA,
        parentThreadId: fixture.parentThreadId,
        turnStatus: "completed",
      });
      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        childThread: childB,
        parentThreadId: fixture.parentThreadId,
        turnStatus: "interrupted",
      });

      const stamped = await waitForStampedSystemMessage(
        harness,
        fixture.parentThreadId,
      );
      expect(stamped.systemMessageKind).toBe("child-outcome-batch");
      expect(stamped.systemMessageSubject).toEqual({
        kind: "thread-batch",
        count: 2,
      });
    });
  });

  it("stamps a needs-attention notification as child-needs-attention", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedParentFixture(harness, "host-child-attention");
      const child = seedThread(harness.deps, {
        projectId: fixture.projectId,
        title: "Blocked child",
        parentThreadId: fixture.parentThreadId,
      });

      await queueChildThreadNeedsAttentionNotificationBestEffort(harness.deps, {
        childThread: child,
        parentThreadId: fixture.parentThreadId,
      });

      const stamped = await waitForStampedSystemMessage(
        harness,
        fixture.parentThreadId,
      );
      expect(stamped.systemMessageKind).toBe("child-needs-attention");
      expect(stamped.systemMessageSubject).toEqual({
        kind: "thread",
        threadId: child.id,
        threadName: "Blocked child",
      });
    });
  });

  it("stamps ownership assignment as ownership-assigned naming the child", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedParentFixture(harness, "host-ownership-assign");
      const child = seedThread(harness.deps, {
        projectId: fixture.projectId,
        title: "Assigned child",
        parentThreadId: fixture.parentThreadId,
      });

      await handleThreadOwnershipChange(harness.deps, {
        previousThread: { ...child, parentThreadId: null },
        updatedThread: { ...child, parentThreadId: fixture.parentThreadId },
        queueParentMessages: true,
      });

      const stamped = await waitForStampedSystemMessage(
        harness,
        fixture.parentThreadId,
      );
      expect(stamped.systemMessageKind).toBe("ownership-assigned");
      expect(stamped.systemMessageSubject).toEqual({
        kind: "thread",
        threadId: child.id,
        threadName: "Assigned child",
      });
    });
  });

  it("stamps ownership removal as ownership-removed naming the child", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedParentFixture(harness, "host-ownership-remove");
      const child = seedThread(harness.deps, {
        projectId: fixture.projectId,
        title: "Released child",
        parentThreadId: null,
      });

      await handleThreadOwnershipChange(harness.deps, {
        previousThread: { ...child, parentThreadId: fixture.parentThreadId },
        updatedThread: { ...child, parentThreadId: null },
        queueParentMessages: true,
      });

      const stamped = await waitForStampedSystemMessage(
        harness,
        fixture.parentThreadId,
      );
      expect(stamped.systemMessageKind).toBe("ownership-removed");
      expect(stamped.systemMessageSubject).toEqual({
        kind: "thread",
        threadId: child.id,
        threadName: "Released child",
      });
    });
  });

  it("stamps a schedule-due wakeup as schedule-due with a null subject", async () => {
    await withTestHarness(async (harness) => {
      // The schedule sweep stamps `schedule-due` with a null subject; assert
      // the persisted shape directly (the full sweep is covered by the
      // schedule-sweep suite) so the null-subject branch is exercised here.
      const fixture = seedParentFixture(harness, "host-schedule-due");
      const request = appendClientTurnEvent(harness.deps, {
        threadId: fixture.parentThreadId,
        environmentId: fixture.environmentId,
        type: "client/turn/requested",
        input: textInput("Run the scheduled prompt."),
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        initiator: "system",
        senderThreadId: null,
        systemMessageKind: "schedule-due",
        systemMessageSubject: null,
        requestMethod: "turn/start",
        source: "tell",
        target: { kind: "new-turn" },
      });

      const row = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, fixture.parentThreadId),
            eq(events.sequence, request.sequence),
          ),
        )
        .get();
      if (!row) {
        throw new Error("Expected the schedule-due event row");
      }
      const data = turnRequestEventDataSchema.parse(JSON.parse(row.data));
      expect(data.systemMessageKind).toBe("schedule-due");
      expect(data.systemMessageSubject ?? null).toBeNull();
    });
  });

  const settledWorkflowStates: ReadonlyArray<{
    status: "completed" | "failed" | "cancelled";
    expectedKind: SystemMessageKind;
  }> = [
    { status: "completed", expectedKind: "workflow-completed" },
    { status: "failed", expectedKind: "workflow-failed" },
    { status: "cancelled", expectedKind: "workflow-cancelled" },
  ];

  for (const { status, expectedKind } of settledWorkflowStates) {
    it(`stamps a ${status} workflow run notification as ${expectedKind}`, async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedParentFixture(harness, `host-workflow-${status}`);
        const run = createRun(
          harness,
          { projectId: fixture.projectId },
          { anchorThreadId: fixture.parentThreadId },
        );
        await startRunToRunning(harness, run.id);

        harness.db.transaction(
          (tx) => {
            settleWorkflowRunInTransaction(tx, {
              id: run.id,
              status,
              failureReason: status === "failed" ? "script_invalid" : null,
              resultJson: null,
              usage: ZERO_USAGE,
            });
            // Settling clears intent; record the settled notification the
            // delivery sweep consumes.
            setWorkflowRunPendingManagerNotification(tx, {
              id: run.id,
              kind: "settled",
            });
          },
          { behavior: "immediate" },
        );

        runWorkflowRunPendingNotificationSweep(harness.deps);

        const stamped = await waitForStampedSystemMessage(
          harness,
          fixture.parentThreadId,
        );
        expect(stamped.systemMessageKind).toBe(expectedKind);
        expect(stamped.systemMessageSubject).toEqual({
          kind: "workflow",
          name: run.workflowName,
          runId: run.id,
        });
      });
    });
  }

  it("stamps an interrupted workflow run notification as workflow-paused", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedParentFixture(harness, "host-workflow-paused");
      const run = createRun(
        harness,
        { projectId: fixture.projectId },
        { anchorThreadId: fixture.parentThreadId },
      );
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host daemon unavailable");
      setWorkflowRunPendingManagerNotification(harness.db, {
        id: run.id,
        kind: "paused",
      });

      runWorkflowRunPendingNotificationSweep(harness.deps);

      const stamped = await waitForStampedSystemMessage(
        harness,
        fixture.parentThreadId,
      );
      expect(stamped.systemMessageKind).toBe("workflow-paused");
      expect(stamped.systemMessageSubject).toEqual({
        kind: "workflow",
        name: run.workflowName,
        runId: run.id,
      });
    });
  });
});

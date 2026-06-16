import { describe, expect, it } from "vitest";
import type { SystemMessageKind, SystemMessageSubject } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { generatedConversationTitle } from "./GeneratedConversationMessage.js";

const threadSubject: SystemMessageSubject = {
  kind: "thread",
  threadId: "thr_child",
  threadName: "Fix auth bug",
};

const workflowSubject: SystemMessageSubject = {
  kind: "workflow",
  name: "Nightly audit",
  runId: "wf_77",
};

interface SystemTitleArgs {
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

// The component always supplies the `agent`-only props; the `system` path
// ignores them, so anchor them to inert values for these system-title cases.
function systemTitle({ systemMessageKind, systemMessageSubject }: SystemTitleArgs) {
  return generatedConversationTitle({
    sourceKind: "system",
    sourceName: "BB",
    sourceThreadId: null,
    systemMessageKind,
    systemMessageSubject,
  });
}

function threadLink(threadId: string): TimelineTitleLink {
  return { kind: "thread", threadId };
}

describe("generatedConversationTitle — system source", () => {
  const threadSubjectCases: ReadonlyArray<{
    kind: SystemMessageKind;
    plain: string;
    verb: string;
  }> = [
    { kind: "ownership-assigned", plain: "Fix auth bug assigned to you", verb: "assigned to you" },
    { kind: "ownership-removed", plain: "Fix auth bug unassigned", verb: "unassigned" },
    { kind: "child-needs-attention", plain: "Fix auth bug needs attention", verb: "needs attention" },
    { kind: "child-completed", plain: "Fix auth bug finished", verb: "finished" },
    { kind: "child-failed", plain: "Fix auth bug failed", verb: "failed" },
    { kind: "child-interrupted", plain: "Fix auth bug was interrupted", verb: "was interrupted" },
  ];

  it.each(threadSubjectCases)(
    "$kind links the thread name and appends the verb",
    ({ kind, plain, verb }) => {
      const title = systemTitle({
        systemMessageKind: kind,
        systemMessageSubject: threadSubject,
      });

      expect(title.plain).toBe(plain);
      expect(title.segments).toHaveLength(2);

      const [nameSegment, verbSegment] = title.segments;
      expect(nameSegment.text).toBe("Fix auth bug");
      expect(nameSegment.em).toBe(true);
      expect(nameSegment.link).toEqual(threadLink("thr_child"));

      expect(verbSegment.text).toBe(verb);
      expect(verbSegment.em).toBe(false);
      expect(verbSegment.link).toBeUndefined();
    },
  );

  it("renders the batch form with the count and no link", () => {
    const title = systemTitle({
      systemMessageKind: "child-outcome-batch",
      systemMessageSubject: { kind: "thread-batch", count: 3 },
    });

    expect(title.plain).toBe("3 threads updated");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.text).toBe("3 threads updated");
    expect(title.segments[0]?.link).toBeUndefined();
  });

  it("renders schedule-due with no subject and no link", () => {
    const title = systemTitle({
      systemMessageKind: "schedule-due",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("Scheduled turn due");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.link).toBeUndefined();
  });

  const workflowCases: ReadonlyArray<{ kind: SystemMessageKind; plain: string }> = [
    { kind: "workflow-completed", plain: "Workflow Nightly audit completed" },
    { kind: "workflow-failed", plain: "Workflow Nightly audit failed" },
    { kind: "workflow-paused", plain: "Workflow Nightly audit paused" },
    { kind: "workflow-cancelled", plain: "Workflow Nightly audit cancelled" },
  ];

  it.each(workflowCases)(
    "$kind emphasizes the workflow name but leaves it unlinked",
    ({ kind, plain }) => {
      const title = systemTitle({
        systemMessageKind: kind,
        systemMessageSubject: workflowSubject,
      });

      expect(title.plain).toBe(plain);
      expect(title.segments).toHaveLength(3);

      const [prefix, nameSegment, verbSegment] = title.segments;
      expect(prefix.text).toBe("Workflow");
      expect(nameSegment.text).toBe("Nightly audit");
      expect(nameSegment.em).toBe(true);
      // A workflow run has no thread to navigate to — name stays unlinked.
      expect(nameSegment.link).toBeUndefined();
      expect(verbSegment.em).toBe(false);
    },
  );

  it("falls back to the generic System Message title for unlabeled rows", () => {
    const title = systemTitle({
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("System Message");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.text).toBe("System Message");
    expect(title.segments[0]?.link).toBeUndefined();
  });

  it("falls back to System Message when the subject shape mismatches the kind", () => {
    // Defensive: a `thread`-expecting kind handed a non-thread subject must not
    // throw — it degrades to the generic title.
    const title = systemTitle({
      systemMessageKind: "child-completed",
      systemMessageSubject: { kind: "thread-batch", count: 2 },
    });

    expect(title.plain).toBe("System Message");
  });
});

describe("generatedConversationTitle — agent source", () => {
  it("links the sender thread name (reference pattern, unchanged)", () => {
    const title = generatedConversationTitle({
      sourceKind: "agent",
      sourceName: "Worker 2",
      sourceThreadId: "thr_sender",
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("Message from Worker 2");
    expect(title.segments).toHaveLength(2);
    expect(title.segments[1]?.text).toBe("Worker 2");
    expect(title.segments[1]?.link).toEqual(threadLink("thr_sender"));
  });
});

import type { TimelineRow } from "@bb/server-contract";
import { ThreadTimelineSurface } from "@/components/thread/timeline/ThreadTimelineSurface";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";

export default {
  title: "thread/Table of Contents",
};

const now = 1_800_000_000_000;

function conversationRow({
  id,
  role,
  text,
  index,
}: {
  id: string;
  role: "user" | "assistant";
  text: string;
  index: number;
}): TimelineRow {
  const base = {
    id,
    threadId: "thr_toc_story",
    turnId: `turn_${Math.floor(index / 2)}`,
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    startedAt: now + index * 1_000,
    createdAt: now + index * 1_000,
    kind: "conversation" as const,
    text,
    attachments: null,
  };
  if (role === "user") {
    return {
      ...base,
      role: "user",
      initiator: "user",
      senderThreadId: null,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
      turnRequest: {
        kind: "message",
        status: "accepted",
      },
      mentions: [],
    };
  }
  return {
    ...base,
    role: "assistant",
    turnRequest: null,
  };
}

const timelineRows: TimelineRow[] = [
  conversationRow({
    id: "row_user_1",
    role: "user",
    index: 0,
    text: "Audit the queued-message drawer and identify the smallest production path for grouping queued messages.",
  }),
  conversationRow({
    id: "row_agent_1",
    role: "assistant",
    index: 1,
    text: "The queue already has sortable rows, so the divider can be another sortable item in the same context.",
  }),
  conversationRow({
    id: "row_user_2",
    role: "user",
    index: 2,
    text: "Keep the table of contents client-only and use the real timeline row markers for jump targets.",
  }),
  conversationRow({
    id: "row_agent_2",
    role: "assistant",
    index: 3,
    text: "The rail can derive user and assistant messages from the timeline rows and use the bottom-anchored scroll body for navigation.",
  }),
  conversationRow({
    id: "row_user_3",
    role: "user",
    index: 4,
    text: "Add enough long messages that the TOC panel overflows and shows the bottom fade.",
  }),
  conversationRow({
    id: "row_agent_3",
    role: "assistant",
    index: 5,
    text: "I will keep the active item synced even while the panel is closed, then reveal the current position on hover.",
  }),
  conversationRow({
    id: "row_user_4",
    role: "user",
    index: 6,
    text: "Verify tab switching keeps each role's active item in view and that clicking a preview jumps to the full row.",
  }),
  conversationRow({
    id: "row_agent_4",
    role: "assistant",
    index: 7,
    text: "The story uses the same ThreadTimelineSurface as the app, so the row markers, spacing, and scroll container match production.",
  }),
];

export function Default() {
  return (
    <div className="h-[640px] overflow-hidden rounded-lg border border-border bg-background">
      <BottomAnchoredScrollBody
        footer={null}
        maxWidthClassName="max-w-3xl"
        contentClassName="gap-2 pt-4"
      >
        <ThreadTimelineSurface
          activeThinking={null}
          isThreadTimelinePending={false}
          timelineError={false}
          showOngoingIndicator={false}
          timelineRows={timelineRows}
          threadId="thr_toc_story"
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </BottomAnchoredScrollBody>
    </div>
  );
}

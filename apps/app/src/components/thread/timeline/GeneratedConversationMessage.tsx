import { memo, useCallback, useMemo, useRef } from "react";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import type {
  PromptTextMention,
  SystemMessageKind,
  SystemMessageSubject,
} from "@bb/domain";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import { type IconName } from "@/components/ui/icon.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import {
  ConversationAttachments,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import {
  clipMentionTextToVisibleRange,
  renderMentionTextSegments,
  shiftMentionsToTextRange,
} from "./ConversationMessageMentions.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { NESTED_TIMELINE_GROUP_LINE_CLASS_NAME } from "./timeline-nested-group-line.js";
import type { TimelineTitleLinkResolver } from "./TimelineTitleView.js";
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { TurnRequestLabel } from "./TurnRequestLabel.js";
import { useOverflowMeasurement } from "./conversation-message-overflow.js";

interface GeneratedConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  mentions: readonly PromptTextMention[];
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  // `system` rows specialize their title/icon on `systemMessageKind` +
  // `systemMessageSubject`; `agent` rows specialize on `sourceName` +
  // `sourceThreadId`. Both groups are always supplied — the inactive group is
  // ignored by the source-kind switch — so the props stay non-optional.
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

type GeneratedConversationSourceKind = "agent" | "system";

interface GeneratedConversationBodyTextArgs {
  initiator: TimelineUserConversationRow["initiator"];
  text: string;
}

interface GeneratedConversationBodySlice {
  startOffset: number;
  text: string;
}

interface TimelineTitleSegmentArgs {
  em: boolean;
  link: TimelineTitleSegment["link"] | null;
  shimmer: boolean;
  text: string;
  truncate: boolean;
}

interface GeneratedConversationTitleArgs {
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

export function generatedConversationBodySlice({
  initiator,
  text,
}: GeneratedConversationBodyTextArgs): GeneratedConversationBodySlice {
  const prefixLength = computeMutedPrefixLength(initiator, text);
  if (prefixLength <= 0) {
    return { startOffset: 0, text };
  }

  const textAfterPrefix = text.slice(prefixLength);
  const trimStartLength =
    textAfterPrefix.length - textAfterPrefix.trimStart().length;
  return {
    startOffset: prefixLength + trimStartLength,
    text: textAfterPrefix.slice(trimStartLength),
  };
}

function timelineTitleSegment({
  em,
  link,
  shimmer,
  text,
  truncate,
}: TimelineTitleSegmentArgs): TimelineTitleSegment {
  const segment: TimelineTitleSegment = {
    em,
    shimmer,
    text,
    truncate,
  };
  if (link !== null) {
    segment.link = link;
  }
  return segment;
}

// A muted verb segment ("finished", "assigned to you", …) — the non-emphasized
// connective text that frames the linked subject.
function verbSegment(text: string): TimelineTitleSegment {
  return timelineTitleSegment({
    em: false,
    link: null,
    shimmer: false,
    text,
    truncate: false,
  });
}

// The emphasized subject segment: a thread name links to its thread; an
// unlinkable subject (workflow run, missing id) renders emphasized but plain.
function subjectSegment(
  text: string,
  threadId: string | null,
): TimelineTitleSegment {
  return timelineTitleSegment({
    em: true,
    link: threadId === null ? null : { kind: "thread", threadId },
    shimmer: false,
    text,
    truncate: true,
  });
}

const SYSTEM_MESSAGE_FALLBACK_SEGMENTS: TimelineTitleSegment[] = [
  timelineTitleSegment({
    em: false,
    link: null,
    shimmer: false,
    text: "System Message",
    truncate: true,
  }),
];

// A `thread`-subject verb title: `[name]` (linked) followed by the verb phrase.
// Falls back to the generic "System Message" title when the row's subject shape
// does not match the kind (defensive — should not happen for stamped rows).
function threadSubjectTitleSegments(
  subject: SystemMessageSubject | null,
  verb: string,
): TimelineTitleSegment[] {
  if (subject === null || subject.kind !== "thread") {
    return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
  return [
    subjectSegment(subject.threadName, subject.threadId),
    verbSegment(verb),
  ];
}

// A workflow title: "Workflow" `[name]` (emphasized but unlinked — a workflow
// run has no thread to navigate to) followed by the settled-state verb.
function workflowTitleSegments(
  subject: SystemMessageSubject | null,
  verb: string,
): TimelineTitleSegment[] {
  if (subject === null || subject.kind !== "workflow") {
    return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
  return [
    verbSegment("Workflow"),
    subjectSegment(subject.name, null),
    verbSegment(verb),
  ];
}

function systemMessageTitleSegments(
  systemMessageKind: SystemMessageKind,
  subject: SystemMessageSubject | null,
): TimelineTitleSegment[] {
  switch (systemMessageKind) {
    case "ownership-assigned":
      return threadSubjectTitleSegments(subject, "assigned to you");
    case "ownership-removed":
      return threadSubjectTitleSegments(subject, "unassigned");
    case "child-needs-attention":
      return threadSubjectTitleSegments(subject, "needs attention");
    case "child-completed":
      return threadSubjectTitleSegments(subject, "finished");
    case "child-failed":
      return threadSubjectTitleSegments(subject, "failed");
    case "child-interrupted":
      return threadSubjectTitleSegments(subject, "was interrupted");
    case "child-outcome-batch":
      return subject !== null && subject.kind === "thread-batch"
        ? [verbSegment(`${subject.count} threads updated`)]
        : SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
    case "schedule-due":
      return [verbSegment("Scheduled turn due")];
    case "workflow-completed":
      return workflowTitleSegments(subject, "completed");
    case "workflow-failed":
      return workflowTitleSegments(subject, "failed");
    case "workflow-paused":
      return workflowTitleSegments(subject, "paused");
    case "workflow-cancelled":
      return workflowTitleSegments(subject, "cancelled");
    case "unlabeled":
      return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
}

export function generatedConversationTitle({
  sourceKind,
  sourceName,
  sourceThreadId,
  systemMessageKind,
  systemMessageSubject,
}: GeneratedConversationTitleArgs): TimelineTitle {
  const segments: TimelineTitleSegment[] =
    sourceKind === "agent"
      ? [
          timelineTitleSegment({
            em: false,
            link: null,
            shimmer: false,
            text: "Message from",
            truncate: false,
          }),
          subjectSegment(sourceName, sourceThreadId),
        ]
      : systemMessageTitleSegments(systemMessageKind, systemMessageSubject);

  return {
    action: null,
    decorations: [],
    plain: segments
      .map((segment) => segment.plainText ?? segment.text)
      .join(" "),
    segments,
    tone: "default",
  };
}

function generatedConversationEmptyText(
  sourceKind: GeneratedConversationSourceKind,
): string {
  switch (sourceKind) {
    case "agent":
      return "Sent an agent message";
    case "system":
      return "Sent a BB system message";
  }
}

function systemMessageIconName(systemMessageKind: SystemMessageKind): IconName {
  switch (systemMessageKind) {
    case "ownership-assigned":
      return "UserRoundPlus";
    case "ownership-removed":
      return "UserRound";
    case "child-needs-attention":
      return "MessageQuestion";
    case "child-completed":
      return "CircleCheck";
    case "child-failed":
      return "CircleX";
    case "child-interrupted":
      return "Square";
    case "child-outcome-batch":
      return "ListTodo";
    case "schedule-due":
      return "Clock";
    case "workflow-completed":
    case "workflow-failed":
    case "workflow-paused":
    case "workflow-cancelled":
      return "Workflow";
    case "unlabeled":
      return "Info";
  }
}

function generatedConversationIconName(
  sourceKind: GeneratedConversationSourceKind,
  systemMessageKind: SystemMessageKind,
): IconName {
  switch (sourceKind) {
    case "agent":
      return "MessageSquare";
    case "system":
      return systemMessageIconName(systemMessageKind);
  }
}

// True only for the ownership kinds, whose one-line body restates the granular
// title verbatim. Those rows render title-only (no body, no preview,
// non-expandable); every other kind keeps its information-bearing body.
function systemMessageIsTitleOnly(
  sourceKind: GeneratedConversationSourceKind,
  systemMessageKind: SystemMessageKind,
): boolean {
  if (sourceKind !== "system") {
    return false;
  }
  return (
    systemMessageKind === "ownership-assigned" ||
    systemMessageKind === "ownership-removed"
  );
}

export const GeneratedConversationMessage = memo(
  function GeneratedConversationMessage({
    attachmentItems,
    mentions,
    onOpenLocalFileLink,
    projectId,
    resolveSegmentLinkHref,
    sourceKind,
    sourceName,
    sourceThreadId,
    systemMessageKind,
    systemMessageSubject,
    text,
    turnRequest,
  }: GeneratedConversationMessageProps) {
    const trimStartLength = text.length - text.trimStart().length;
    const messageText = text.trim();
    const messageMentions = useMemo(
      () =>
        shiftMentionsToTextRange({
          mentions,
          rangeStart: trimStartLength,
          rangeEnd: trimStartLength + messageText.length,
        }),
      [mentions, messageText.length, trimStartLength],
    );
    const requestLabel = turnRequestLabel(turnRequest);
    const title = useMemo(
      () =>
        generatedConversationTitle({
          sourceKind,
          sourceName,
          sourceThreadId,
          systemMessageKind,
          systemMessageSubject,
        }),
      [
        sourceKind,
        sourceName,
        sourceThreadId,
        systemMessageKind,
        systemMessageSubject,
      ],
    );
    const leadingIcon = generatedConversationIconName(
      sourceKind,
      systemMessageKind,
    );
    // Title-only rows (ownership assigned/removed) restate their body in the
    // title; suppress the body, the collapsed preview, and expansion entirely.
    const titleOnly = systemMessageIsTitleOnly(sourceKind, systemMessageKind);
    const hasExpandedOnlyContent =
      attachmentItems.filePaths.length > 0 ||
      attachmentItems.imageItems.length > 0 ||
      requestLabel !== null;
    const collapsedPreviewLine = messageText.split(/\r\n|\r|\n/u, 1)[0] ?? "";
    const hasAdditionalBodyLines =
      collapsedPreviewLine.length < messageText.length;
    const collapsedPreviewTextRef = useRef<HTMLParagraphElement>(null);
    const collapsedPreviewOverflowMeasurement = useOverflowMeasurement({
      elementRef: collapsedPreviewTextRef,
      enabled: !titleOnly && messageText.length > 0,
      measurementKey: messageText,
    });
    const expandable =
      !titleOnly &&
      (hasExpandedOnlyContent ||
        hasAdditionalBodyLines ||
        collapsedPreviewOverflowMeasurement === "overflowing");
    const collapsedPreviewBody = clipMentionTextToVisibleRange({
      mentions: messageMentions,
      rangeStart: 0,
      text: collapsedPreviewLine,
    });
    const collapsedPreview = !titleOnly && collapsedPreviewBody.text ? (
      <div
        className={`${NESTED_TIMELINE_GROUP_LINE_CLASS_NAME} max-w-full min-w-0`}
      >
        <p
          ref={collapsedPreviewTextRef}
          className="min-w-0 truncate pl-2 text-sm leading-relaxed text-foreground"
        >
          {renderMentionTextSegments({
            mentions: collapsedPreviewBody.mentions,
            text: collapsedPreviewBody.text,
          })}
          {expandable ? (
            <span className="text-muted-foreground">...</span>
          ) : null}
        </p>
      </div>
    ) : null;
    const renderBody = useCallback(
      () => (
        <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
          <div className="pl-2 text-sm leading-relaxed text-foreground">
            {messageText ? (
              // `system` bodies render full markdown while preserving the
              // `@thread:<id>` mention pills (resolved from `messageMentions`).
              // `agent` bodies stay on the offset-based `renderMentionTextSegments`
              // renderer: the markdown path only understands `@thread:<id>`
              // tokens and would silently drop the offset-based `path` mentions
              // an agent message can carry. The collapsed preview above stays
              // plain text for both. Both branches share the surrounding
              // `pl-2 text-sm leading-relaxed text-foreground` container, so
              // typography is identical.
              sourceKind === "system" ? (
                <MarkdownPreview
                  content={messageText}
                  threadMentions={
                    resolveSegmentLinkHref
                      ? {
                          mentions: messageMentions,
                          resolveLinkHref: resolveSegmentLinkHref,
                        }
                      : undefined
                  }
                />
              ) : (
                <p className="whitespace-pre-wrap break-words">
                  {renderMentionTextSegments({
                    mentions: messageMentions,
                    text: messageText,
                  })}
                </p>
              )
            ) : (
              <p className="text-muted-foreground">
                {generatedConversationEmptyText(sourceKind)}
              </p>
            )}
            <ConversationAttachments
              align="start"
              filePaths={attachmentItems.filePaths}
              imageItems={attachmentItems.imageItems}
              onOpenLocalFileLink={onOpenLocalFileLink}
              projectId={projectId}
            />
            {requestLabel ? (
              <div className="mt-1 flex items-center justify-start gap-2">
                <TurnRequestLabel turnRequest={turnRequest} />
              </div>
            ) : null}
          </div>
        </div>
      ),
      [
        attachmentItems.filePaths,
        attachmentItems.imageItems,
        messageText,
        messageMentions,
        onOpenLocalFileLink,
        projectId,
        resolveSegmentLinkHref,
        sourceKind,
        requestLabel,
        turnRequest,
      ],
    );

    return (
      <ExpandableTimelineRow
        title={title}
        collapsedPreview={collapsedPreview}
        expandable={expandable}
        leadingIcon={leadingIcon}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        renderBody={renderBody}
      />
    );
  },
);

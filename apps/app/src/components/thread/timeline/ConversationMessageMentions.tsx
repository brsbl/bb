import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import { Icon } from "@/components/ui/icon.js";
import { AppRouteAnchor } from "@/components/ui/app-route-anchor.js";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import {
  PROMPT_MENTION_PILL_CLASS,
  promptMentionIconName,
  promptMentionTooltipLabel,
} from "@/components/promptbox/mentions/prompt-mention-display";
import { promptMentionClipboardDataAttributes } from "@/components/promptbox/mentions/prompt-mention-clipboard";

interface PromptMentionPillProps {
  resource: PromptMentionResource;
  serializedText: string;
  /**
   * Explicit href for a thread mention, used by the markdown body renderer to
   * route through the timeline's `resolveSegmentLinkHref` (consistent with the
   * title links). When absent, a thread mention falls back to its
   * `resource.projectId` react-router link; a non-thread mention ignores this.
   */
  linkHref?: string;
}

interface NormalizeMentionsArgs {
  mentions: readonly PromptTextMention[];
  textLength: number;
}

export interface ShiftMentionsToTextRangeArgs {
  mentions: readonly PromptTextMention[];
  rangeEnd: number;
  rangeStart: number;
}

export interface RenderMentionTextSegmentsArgs {
  mentions: readonly PromptTextMention[];
  text: string;
}

export interface ClipMentionTextToVisibleRangeArgs {
  mentions: readonly PromptTextMention[];
  rangeStart: number;
  text: string;
}

export interface ClipMentionTextToVisibleRangeResult {
  mentions: PromptTextMention[];
  text: string;
}

export function normalizePromptTextMentions({
  mentions,
  textLength,
}: NormalizeMentionsArgs): PromptTextMention[] {
  return mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= textLength,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

export function shiftMentionsToTextRange({
  mentions,
  rangeEnd,
  rangeStart,
}: ShiftMentionsToTextRangeArgs): PromptTextMention[] {
  return mentions.flatMap((mention) => {
    if (mention.start < rangeStart || mention.end > rangeEnd) {
      return [];
    }
    return [
      {
        ...mention,
        start: mention.start - rangeStart,
        end: mention.end - rangeStart,
      },
    ];
  });
}

export function clipMentionTextToVisibleRange({
  mentions,
  rangeStart,
  text,
}: ClipMentionTextToVisibleRangeArgs): ClipMentionTextToVisibleRangeResult {
  const rangeEnd = rangeStart + text.length;
  const clippedRangeEnd = mentions.reduce<number>((currentEnd, mention) => {
    const crossesVisibleEnd =
      mention.start >= rangeStart &&
      mention.start < currentEnd &&
      mention.end > currentEnd;
    return crossesVisibleEnd ? mention.start : currentEnd;
  }, rangeEnd);

  return {
    text: text.slice(0, clippedRangeEnd - rangeStart),
    mentions: shiftMentionsToTextRange({
      mentions,
      rangeStart,
      rangeEnd: clippedRangeEnd,
    }),
  };
}

function mentionPillClassName(interactive: boolean): string {
  return cn(
    PROMPT_MENTION_PILL_CLASS,
    "bg-surface-raised/50 no-underline hover:no-underline",
    interactive && "hover:bg-state-hover",
  );
}

export function PromptMentionPill({
  resource,
  serializedText,
  linkHref,
}: PromptMentionPillProps) {
  const title = promptMentionTooltipLabel(resource);
  const clipboardAttributes = promptMentionClipboardDataAttributes({
    resource,
    serializedText,
  });
  const labelNode = (
    <>
      <Icon
        name={promptMentionIconName(resource)}
        className="size-3.5 shrink-0 self-center text-muted-foreground"
        aria-hidden
      />
      <span className="truncate">{resource.label}</span>
    </>
  );

  // Markdown bodies route thread mentions through `resolveSegmentLinkHref`
  // (same resolver the title links use); the plain-text path passes no
  // `linkHref` and keeps the `resource.projectId` react-router link below.
  if (resource.kind === "thread" && linkHref) {
    return (
      <AppRouteAnchor
        className={mentionPillClassName(true)}
        {...clipboardAttributes}
        href={linkHref}
        title={title}
      >
        {labelNode}
      </AppRouteAnchor>
    );
  }

  if (resource.kind === "thread" && resource.projectId) {
    return (
      <Link
        className={mentionPillClassName(true)}
        {...clipboardAttributes}
        to={getThreadRoutePath({
          projectId: resource.projectId,
          threadId: resource.threadId,
        })}
        title={title}
      >
        {labelNode}
      </Link>
    );
  }

  // Timeline path mentions are workspace/thread-storage-relative resources.
  // Opening them needs the same environment and thread-storage context
  // the composer resolver owns, so they are intentionally display-only here.
  // Thread mentions without project context are also display-only; linking
  // through the current page project can misroute cross-project mentions.
  return (
    <span
      className={mentionPillClassName(false)}
      {...clipboardAttributes}
      title={title}
    >
      {labelNode}
    </span>
  );
}

export function renderMentionTextSegments({
  mentions,
  text,
}: RenderMentionTextSegmentsArgs): ReactNode {
  const normalizedMentions = normalizePromptTextMentions({
    mentions,
    textLength: text.length,
  });
  if (normalizedMentions.length === 0) {
    return text;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const mention of normalizedMentions) {
    if (mention.start < cursor) {
      continue;
    }
    if (mention.start > cursor) {
      segments.push(text.slice(cursor, mention.start));
    }
    segments.push(
      <PromptMentionPill
        key={`${mention.start}:${mention.end}:${mention.resource.kind}`}
        resource={mention.resource}
        serializedText={text.slice(mention.start, mention.end)}
      />,
    );
    cursor = mention.end;
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }
  return segments;
}

/**
 * Resolves a thread mention's display resource for the markdown body renderer:
 * the `@thread:<id>` token carries only the id, so the label/projectId are
 * recovered from the body `mentions` array (matched by `threadId`). Falls back
 * to a display-only resource labelled with the id when no mention matches.
 */
export function resolveThreadMentionResource(
  mentions: readonly PromptTextMention[],
  threadId: string,
): PromptMentionResource {
  for (const mention of mentions) {
    if (
      mention.resource.kind === "thread" &&
      mention.resource.threadId === threadId
    ) {
      return mention.resource;
    }
  }
  return { kind: "thread", threadId, label: threadId };
}

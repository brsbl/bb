import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { cn } from "@/lib/utils";

/**
 * PROTOTYPE — Thread table of contents.
 *
 * A ChatGPT-style index rail pinned to the left edge of a thread. Collapsed it
 * shows one short tick per user message; hovering the rail reveals a panel that
 * lists each user message and lets you click to scroll to it. The tick for the
 * message currently in view is highlighted as you scroll (scroll-spy).
 *
 * Self-contained: nothing here is wired into the real ThreadDetailView. The demo
 * stage owns its own scroll container and mock conversation so the interaction
 * can be exercised in Ladle.
 */

export interface TocConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface TocItem {
  id: string;
  label: string;
}

type TocTab = "user" | "agent";

interface ThreadTableOfContentsRailProps {
  userItems: readonly TocItem[];
  agentItems: readonly TocItem[];
  activeUserId: string | null;
  activeAgentId: string | null;
  onSelect: (id: string) => void;
}

/** Collapse a message body to a single, whitespace-normalized preview line. */
function toPreviewLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * One half of the panel's tab switcher. Equal-width segments (flex-1) so the
 * two tabs fill the header evenly, styled to match the app's TabPill treatment.
 */
function TocPanelTab({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex h-7 flex-1 items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      {label}
    </button>
  );
}

/**
 * The rail itself. Pin it inside a `relative` scroll-pane wrapper; it overlays
 * the left gutter and opens its panel over the conversation on hover/focus.
 */
function ThreadTableOfContentsRail({
  userItems,
  agentItems,
  activeUserId,
  activeAgentId,
  onSelect,
}: ThreadTableOfContentsRailProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TocTab>("user");
  const scrollOverflow = useScrollOverflowState<HTMLDivElement>({
    measureOverflow: true,
  });
  const itemEls = useRef(new Map<string, HTMLElement>());

  // Keep the panel's scroll synced to the thread: bring the active item (which
  // tracks the thread's scroll position via scroll-spy) into view. Runs while
  // closed too, so the panel already shows your current spot when it opens, and
  // on tab change it lands on that tab's current message.
  useEffect(() => {
    const activeId = tab === "user" ? activeUserId : activeAgentId;
    const container = scrollOverflow.scrollRef.current;
    const el = activeId ? itemEls.current.get(activeId) : null;
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 8;
    if (elRect.top < containerRect.top + pad) {
      container.scrollTo({
        top: container.scrollTop - (containerRect.top + pad - elRect.top),
      });
    } else if (elRect.bottom > containerRect.bottom - pad) {
      container.scrollTo({
        top: container.scrollTop + (elRect.bottom - (containerRect.bottom - pad)),
      });
    }
  }, [tab, activeUserId, activeAgentId, open, scrollOverflow.scrollRef]);

  if (userItems.length === 0 && agentItems.length === 0) return null;

  const items = tab === "user" ? userItems : agentItems;
  const activeId = tab === "user" ? activeUserId : activeAgentId;

  return (
    <div
      className="absolute left-0 top-1/2 z-20 -translate-y-1/2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <div className="relative">
        {/* Collapsed ticks — the rail, indexing user turns. This block is the
            only hover target; it fades out as the panel opens. */}
        <div
          aria-hidden={open}
          className={cn(
            "flex flex-col items-start gap-2 py-2 pl-3 pr-2 transition-opacity duration-150",
            open ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          {userItems.map((item) => (
            <span
              key={item.id}
              className={cn(
                "h-[3px] rounded-full transition-all duration-150",
                item.id === activeUserId
                  ? "w-5 bg-foreground"
                  : "w-3 bg-foreground/25",
              )}
            />
          ))}
        </div>

        {/* Expanded panel — tabbed previews, click to navigate. */}
        <div
          className={cn(
            "absolute left-1 top-1/2 w-72 max-w-[calc(100vw-3rem)] -translate-y-1/2 rounded-lg border border-border bg-popover p-1 shadow-lg transition-all duration-150",
            open
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-1 opacity-0",
          )}
        >
          <div className="flex items-center gap-1 pb-1">
            <TocPanelTab
              label="Agent messages"
              active={tab === "agent"}
              onSelect={() => setTab("agent")}
            />
            <TocPanelTab
              label="Your messages"
              active={tab === "user"}
              onSelect={() => setTab("user")}
            />
          </div>
          <div className="relative isolate">
            <div
              ref={scrollOverflow.scrollRef}
              className="max-h-64 overflow-y-auto overflow-x-hidden"
            >
              <div
                ref={scrollOverflow.topSentinelRef}
                aria-hidden
                className="h-px w-full"
              />
              <ul className="flex flex-col">
                {items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <button
                        ref={(node) => {
                          if (node) itemEls.current.set(item.id, node);
                          else itemEls.current.delete(item.id);
                        }}
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className={cn(
                          "flex w-full rounded-md px-2 py-1.5 text-left transition-colors",
                          active
                            ? "bg-surface-selected"
                            : "hover:bg-state-hover",
                        )}
                      >
                        <span
                          className={cn(
                            "line-clamp-2 text-xs leading-snug",
                            active
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div
                ref={scrollOverflow.bottomSentinelRef}
                aria-hidden
                className="h-px w-full"
              />
            </div>
            {/* Bottom edge fade hints that the list scrolls past the panel. */}
            {scrollOverflow.belowOverflow ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-popover to-transparent"
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-border bg-surface-recessed px-3.5 py-2 text-sm leading-relaxed text-foreground">
      {children}
    </div>
  );
}

function AssistantBlock({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[92%] space-y-3 text-sm leading-relaxed text-foreground/90">
      {children}
    </div>
  );
}

export interface ThreadTocDemoProps {
  messages?: readonly TocConversationMessage[];
  /** Pane height; defaults to a comfortable preview size. */
  height?: number;
  /** Extra classes for the pane container (e.g. to flex-fill in a layout). */
  className?: string;
}

/**
 * Full demo stage: a scrollable mock thread with the TOC rail overlaid. Tracks
 * the user message nearest the top of the viewport as the active item.
 */
export function ThreadTocDemo({
  messages = DEMO_CONVERSATION,
  height = 620,
  className,
}: ThreadTocDemoProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageEls = useRef(new Map<string, HTMLDivElement>());

  const userItems = useMemo<TocItem[]>(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => ({ id: message.id, label: toPreviewLabel(message.text) })),
    [messages],
  );
  const agentItems = useMemo<TocItem[]>(
    () =>
      messages
        .filter((message) => message.role === "assistant")
        .map((message) => ({ id: message.id, label: toPreviewLabel(message.text) })),
    [messages],
  );

  const [activeUserId, setActiveUserId] = useState<string | null>(
    userItems[0]?.id ?? null,
  );
  const [activeAgentId, setActiveAgentId] = useState<string | null>(
    agentItems[0]?.id ?? null,
  );

  const recomputeActive = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    // Treat the message whose top sits just above this line as "current".
    const threshold = containerTop + 96;

    // Snap to the last message of each role when scrolled to the very bottom.
    const atBottom =
      container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
    if (atBottom) {
      setActiveUserId(userItems.at(-1)?.id ?? null);
      setActiveAgentId(agentItems.at(-1)?.id ?? null);
      return;
    }

    // Walk messages top-to-bottom; the last of each role above the threshold is
    // that role's current message.
    let user: string | null = userItems[0]?.id ?? null;
    let agent: string | null = agentItems[0]?.id ?? null;
    for (const message of messages) {
      const el = messageEls.current.get(message.id);
      if (!el) continue;
      if (el.getBoundingClientRect().top - threshold > 0) break;
      if (message.role === "user") user = message.id;
      else agent = message.id;
    }
    setActiveUserId(user);
    setActiveAgentId(agent);
  }, [messages, userItems, agentItems]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recomputeActive);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    // Compute the initial active item after the first paint (avoids a
    // synchronous setState during the effect body).
    frame = requestAnimationFrame(recomputeActive);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", onScroll);
    };
  }, [recomputeActive]);

  const scrollToMessage = useCallback((id: string) => {
    const container = scrollRef.current;
    const el = messageEls.current.get(id);
    if (!container || !el) return;
    const top =
      container.scrollTop +
      (el.getBoundingClientRect().top - container.getBoundingClientRect().top) -
      20;
    container.scrollTo({ top, behavior: "smooth" });
    if (messages.find((message) => message.id === id)?.role === "assistant") {
      setActiveAgentId(id);
    } else {
      setActiveUserId(id);
    }
  }, [messages]);

  return (
    <div
      className={cn(
        "relative w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
      style={{ height }}
    >
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto py-8 pl-16 pr-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {messages.map((message) => (
            <div
              key={message.id}
              ref={(node) => {
                if (node) messageEls.current.set(message.id, node);
                else messageEls.current.delete(message.id);
              }}
              className="flex flex-col scroll-mt-6"
            >
              {message.role === "user" ? (
                <UserBubble>{message.text}</UserBubble>
              ) : (
                <AssistantBlock>
                  {message.text.split("\n\n").map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </AssistantBlock>
              )}
            </div>
          ))}
        </div>
      </div>

      <ThreadTableOfContentsRail
        userItems={userItems}
        agentItems={agentItems}
        activeUserId={activeUserId}
        activeAgentId={activeAgentId}
        onSelect={scrollToMessage}
      />
    </div>
  );
}

const ASSISTANT_FILLER =
  "Here's what I found. The relevant code lives in a few small modules, and the change is contained.\n\nI walked the call sites, confirmed the data shape at the boundary, and added a focused test that would have failed before. Let me know if you want me to widen the scope or keep it minimal.";

const LONG_ASSISTANT_FILLER =
  "Good question. The re-render happens because the parent passes a fresh callback on every keystroke, so the memoized child sees a new prop identity each time.\n\nThe fix is to stabilize the handler with useCallback and to derive the membership key once instead of recomputing it inline.\n\nI also checked the surrounding rows — they already memoize correctly, so this is the only hot path. Want me to apply it and run the timeline tests?";

/**
 * A believable bb coding conversation, long enough to scroll. Seven user turns
 * gives the rail seven ticks to index.
 */
export const DEMO_CONVERSATION: readonly TocConversationMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Let's prototype a left-side table of contents for threads, ChatGPT style.",
  },
  { id: "a1", role: "assistant", text: ASSISTANT_FILLER },
  {
    id: "u2",
    role: "user",
    text: "Why is the queued message list re-rendering on every keystroke in the composer?",
  },
  { id: "a2", role: "assistant", text: LONG_ASSISTANT_FILLER },
  {
    id: "u3",
    role: "user",
    text: "Add a regression test that fails before the memoization fix and passes after.",
  },
  { id: "a3", role: "assistant", text: ASSISTANT_FILLER },
  {
    id: "u4",
    role: "user",
    text: "The scroll-to-bottom button flickers when a new turn streams in — can we debounce it?",
  },
  { id: "a4", role: "assistant", text: LONG_ASSISTANT_FILLER },
  {
    id: "u5",
    role: "user",
    text: "Now wire the table of contents into ThreadDetailView behind a feature flag.",
  },
  { id: "a5", role: "assistant", text: ASSISTANT_FILLER },
  {
    id: "u6",
    role: "user",
    text: "Make the active tick track the message currently in the viewport as I scroll.",
  },
  { id: "a6", role: "assistant", text: LONG_ASSISTANT_FILLER },
  {
    id: "u7",
    role: "user",
    text: "Ship it: run typecheck and the timeline tests, then summarize the diff for review.",
  },
  { id: "a7", role: "assistant", text: ASSISTANT_FILLER },
];

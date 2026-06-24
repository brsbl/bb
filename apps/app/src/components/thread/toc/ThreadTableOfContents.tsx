import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineRow } from "@bb/server-contract";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  label: string;
  role: "user" | "assistant";
}

type TocTab = "user" | "agent";

interface ActiveItemIds {
  agent: string | null;
  user: string | null;
}

interface ThreadTableOfContentsProps {
  timelineRows: readonly TimelineRow[];
}

function toPreviewLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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

function useConversationTocItems(timelineRows: readonly TimelineRow[]) {
  return useMemo(() => {
    const userItems: TocItem[] = [];
    const agentItems: TocItem[] = [];

    for (const row of timelineRows) {
      if (row.kind !== "conversation") continue;
      const item: TocItem = {
        id: row.id,
        label: toPreviewLabel(row.text),
        role: row.role,
      };
      if (row.role === "user") {
        userItems.push(item);
      } else {
        agentItems.push(item);
      }
    }

    return { agentItems, userItems };
  }, [timelineRows]);
}

function findTimelineRowElements(
  scrollElement: HTMLElement | null,
): HTMLElement[] {
  return scrollElement
    ? Array.from(
        scrollElement.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
      )
    : [];
}

function findTimelineRowElement(
  scrollElement: HTMLElement | null,
  rowId: string,
): HTMLElement | null {
  return (
    findTimelineRowElements(scrollElement).find(
      (row) => row.dataset.timelineRowId === rowId,
    ) ?? null
  );
}

function findActiveItemIds({
  agentItems,
  scrollElement,
  userItems,
}: {
  agentItems: readonly TocItem[];
  scrollElement: HTMLElement | null;
  userItems: readonly TocItem[];
}): ActiveItemIds {
  if (!scrollElement || (userItems.length === 0 && agentItems.length === 0)) {
    return { agent: null, user: null };
  }
  const scrollTop = scrollElement.getBoundingClientRect().top;
  const rolesById = new Map<string, TocTab>();
  for (const item of userItems) rolesById.set(item.id, "user");
  for (const item of agentItems) rolesById.set(item.id, "agent");
  let nearestUser: { id: string; distance: number } | null = null;
  let nearestAgent: { id: string; distance: number } | null = null;

  for (const row of findTimelineRowElements(scrollElement)) {
    const rowId = row.dataset.timelineRowId;
    if (!rowId) continue;
    const role = rolesById.get(rowId);
    if (!role) continue;
    const rect = row.getBoundingClientRect();
    const distance =
      rect.top <= scrollTop ? scrollTop - rect.top : rect.top - scrollTop;
    const nearest = { id: rowId, distance };
    if (role === "user") {
      if (!nearestUser || distance < nearestUser.distance) {
        nearestUser = nearest;
      }
    } else if (!nearestAgent || distance < nearestAgent.distance) {
      nearestAgent = nearest;
    }
  }

  return { agent: nearestAgent?.id ?? null, user: nearestUser?.id ?? null };
}

export function ThreadTableOfContents({
  timelineRows,
}: ThreadTableOfContentsProps) {
  const bottomAnchor = useBottomAnchoredScroll();
  const { agentItems, userItems } = useConversationTocItems(timelineRows);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TocTab>("user");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const {
    belowOverflow,
    bottomSentinelRef,
    scrollRef,
    topSentinelRef,
  } = useScrollOverflowState<HTMLDivElement>({
    measureOverflow: true,
  });
  const itemEls = useRef(new Map<string, HTMLElement>());
  const activeIdsRef = useRef<ActiveItemIds>({ agent: null, user: null });
  const activeUpdateFrameRef = useRef<number | null>(null);

  const updateActiveItems = useCallback(() => {
    const scrollElement = bottomAnchor?.getScrollElement() ?? null;
    const nextActiveIds = findActiveItemIds({
      agentItems,
      scrollElement,
      userItems,
    });
    const currentActiveIds = activeIdsRef.current;
    if (nextActiveIds.user !== currentActiveIds.user) {
      setActiveUserId(nextActiveIds.user);
    }
    if (nextActiveIds.agent !== currentActiveIds.agent) {
      setActiveAgentId(nextActiveIds.agent);
    }
    activeIdsRef.current = nextActiveIds;
  }, [agentItems, bottomAnchor, userItems]);

  const scheduleActiveItemsUpdate = useCallback(() => {
    if (activeUpdateFrameRef.current !== null) return;
    activeUpdateFrameRef.current = window.requestAnimationFrame(() => {
      activeUpdateFrameRef.current = null;
      updateActiveItems();
    });
  }, [updateActiveItems]);

  useEffect(() => {
    scheduleActiveItemsUpdate();
    const scrollElement = bottomAnchor?.getScrollElement();
    if (!scrollElement) return;
    scrollElement.addEventListener("scroll", scheduleActiveItemsUpdate, {
      passive: true,
    });
    const resizeObserver = new ResizeObserver(scheduleActiveItemsUpdate);
    resizeObserver.observe(scrollElement);
    return () => {
      scrollElement.removeEventListener("scroll", scheduleActiveItemsUpdate);
      resizeObserver.disconnect();
      if (activeUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(activeUpdateFrameRef.current);
        activeUpdateFrameRef.current = null;
      }
    };
  }, [bottomAnchor, scheduleActiveItemsUpdate]);

  useEffect(() => {
    const activeId = tab === "user" ? activeUserId : activeAgentId;
    const container = scrollRef.current;
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
        top:
          container.scrollTop + (elRect.bottom - (containerRect.bottom - pad)),
      });
    }
  }, [tab, activeUserId, activeAgentId, open, scrollRef]);

  const handleSelect = useCallback(
    (id: string) => {
      const scrollElement = bottomAnchor?.getScrollElement();
      const row = scrollElement
        ? findTimelineRowElement(scrollElement, id)
        : null;
      if (!row) return;
      bottomAnchor?.scrollElementIntoView({
        element: row,
        options: { block: "start", inline: "nearest" },
      });
    },
    [bottomAnchor],
  );

  if (userItems.length === 0 && agentItems.length === 0) return null;

  const items = tab === "user" ? userItems : agentItems;
  const activeId = tab === "user" ? activeUserId : activeAgentId;

  return (
    <div
      className="relative h-0 w-0"
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
              ref={scrollRef}
              className="max-h-64 overflow-y-auto overflow-x-hidden"
            >
              <div
                ref={topSentinelRef}
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
                        onClick={() => handleSelect(item.id)}
                        className={cn(
                          "flex w-full rounded-md px-2 py-1.5 text-left transition-colors",
                          active
                            ? "bg-state-hover"
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
                ref={bottomSentinelRef}
                aria-hidden
                className="h-px w-full"
              />
            </div>
            {belowOverflow ? (
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

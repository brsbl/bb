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

function findTimelineRowElement(
  scrollElement: HTMLElement,
  rowId: string,
): HTMLElement | null {
  const rows = scrollElement.querySelectorAll<HTMLElement>(
    "[data-timeline-row-id]",
  );
  for (const row of rows) {
    if (row.dataset.timelineRowId === rowId) return row;
  }
  return null;
}

function findActiveItemId(
  scrollElement: HTMLElement | null,
  items: readonly TocItem[],
): string | null {
  if (!scrollElement || items.length === 0) return null;
  const scrollTop = scrollElement.getBoundingClientRect().top;
  let nearest: { id: string; distance: number } | null = null;

  for (const item of items) {
    const row = findTimelineRowElement(scrollElement, item.id);
    if (!row) continue;
    const rect = row.getBoundingClientRect();
    const distance =
      rect.top <= scrollTop ? scrollTop - rect.top : rect.top - scrollTop;
    if (!nearest || distance < nearest.distance) {
      nearest = { id: item.id, distance };
    }
  }

  return nearest?.id ?? null;
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
  const scrollOverflow = useScrollOverflowState<HTMLDivElement>({
    measureOverflow: true,
  });
  const itemEls = useRef(new Map<string, HTMLElement>());

  const updateActiveItems = useCallback(() => {
    const scrollElement = bottomAnchor?.getScrollElement() ?? null;
    setActiveUserId(findActiveItemId(scrollElement, userItems));
    setActiveAgentId(findActiveItemId(scrollElement, agentItems));
  }, [agentItems, bottomAnchor, userItems]);

  useEffect(() => {
    updateActiveItems();
    const scrollElement = bottomAnchor?.getScrollElement();
    if (!scrollElement) return;
    scrollElement.addEventListener("scroll", updateActiveItems, {
      passive: true,
    });
    const resizeObserver = new ResizeObserver(updateActiveItems);
    resizeObserver.observe(scrollElement);
    return () => {
      scrollElement.removeEventListener("scroll", updateActiveItems);
      resizeObserver.disconnect();
    };
  }, [bottomAnchor, updateActiveItems]);

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
        top:
          container.scrollTop + (elRect.bottom - (containerRect.bottom - pad)),
      });
    }
  }, [tab, activeUserId, activeAgentId, open, scrollOverflow.scrollRef]);

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
                        onClick={() => handleSelect(item.id)}
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

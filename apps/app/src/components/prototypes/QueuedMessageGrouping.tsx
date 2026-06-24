import { useCallback, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { cn } from "@/lib/utils";

/**
 * PROTOTYPE — Grouping queued messages into a single turn.
 *
 * Queued messages reorder exactly as they do today. The new affordance is a
 * draggable divider that starts directly under the first queued message: drag
 * it down to pull subsequent messages into the group that gets sent together
 * with the first message after the next agent turn. The group is always the
 * prefix of the queue [first … divider]; everything below keeps sending one
 * message per turn.
 *
 * The divider is a dnd-kit sortable item interleaved with the message rows, so
 * dragging it (or any row across it) uses the exact same smooth reorder UX. The
 * divider and its handle reveal on hover, like the per-row reorder grip.
 *
 * Self-contained: no server wiring. State is local so it can be exercised in
 * Ladle.
 */

export interface QueuedMessageItem {
  id: string;
  text: string;
  attachments?: number;
}

const DIVIDER_ID = "__group_divider__";

// Lock drags to the vertical axis so rows and the divider track the cursor the
// same way the production reorder does.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

interface SortableQueuedRowProps {
  message: QueuedMessageItem;
  index: number;
  reorderDisabled: boolean;
  onSend: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

function SortableQueuedRow({
  message,
  index,
  reorderDisabled,
  onSend,
  onEdit,
  onDelete,
}: SortableQueuedRowProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: message.id, disabled: reorderDisabled });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/row list-none",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={cn(
            "-ml-1 flex h-7 shrink-0 items-center rounded-md px-0.5 text-muted-foreground",
            !reorderDisabled && "cursor-grab active:cursor-grabbing",
          )}
          disabled={reorderDisabled}
          aria-label={`Reorder message ${index + 1}`}
          title="Reorder"
          {...attributes}
          {...listeners}
        >
          <Icon
            name="DragDropVertical"
            className={cn(
              "size-3.5 opacity-0 transition-opacity",
              !reorderDisabled && "group-hover/row:opacity-100",
            )}
            aria-hidden="true"
          />
          <Icon name="ArrowTurnForward" className="size-3.5 opacity-70" />
        </button>

        <div className="min-w-0 flex-1">
          <div
            className="fade-clip-right min-w-0 overflow-hidden whitespace-nowrap text-xs leading-4 text-foreground"
            title={message.text}
          >
            {message.text}
          </div>
        </div>

        {message.attachments ? (
          <span className="shrink-0 text-2xs text-subtle-foreground opacity-70">
            {message.attachments === 1
              ? "1 attachment"
              : `${message.attachments} attachments`}
          </span>
        ) : null}

        <div className="ml-1 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            onClick={() => onSend(message.id)}
            aria-label="Send now"
            title="Send now"
          >
            <Icon name="Sent" className="size-4 opacity-70" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            onClick={() => onEdit(message.id)}
            aria-label={`Edit message ${index + 1}`}
            title="Edit"
          >
            <Icon name="Edit" className="size-4 opacity-70" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(message.id)}
            aria-label={`Delete message ${index + 1}`}
            title="Delete"
          >
            <Icon name="Trash2" className="size-4 opacity-70" />
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * The group boundary, rendered as a sortable item so it drags with the same
 * dnd-kit smoothness as the rows. Its line + handle reveal on hover of the
 * queued list (`group/queue`), and stay visible while it's being dragged. The
 * row reserves its height whether or not it's revealed, so hovering never
 * shifts the layout.
 */
function SortableDivider() {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: DIVIDER_ID });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/divider relative list-none px-2.5 py-1.5",
        isDragging && "z-10",
      )}
    >
      {/* Divider line — always visible, neutral to match the drawer borders. */}
      <div className="h-px w-full bg-border" />
      {/* Handle floats over the line center — absolute, so it adds no height to
          the gap. Revealed on hover only; as a descendant of the li, hovering it
          keeps the divider active, and it only intercepts pointer events once
          revealed. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={setActivatorNodeRef}
                type="button"
                className={cn(
                  "pointer-events-none flex h-4 shrink-0 cursor-grab touch-none select-none items-center rounded-full border border-border bg-surface-raised px-1.5 text-muted-foreground opacity-0 shadow-sm transition hover:border-foreground/40 active:cursor-grabbing group-hover/divider:pointer-events-auto group-hover/divider:opacity-100",
                  isDragging &&
                    "pointer-events-auto cursor-grabbing border-foreground/50 text-foreground opacity-100",
                )}
                aria-label="Messages above send together"
                {...attributes}
                {...listeners}
              >
                <Icon
                  name="DragDropHorizontal"
                  className="size-3.5"
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Messages above send together</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </li>
  );
}

export interface QueuedMessageGroupingDemoProps {
  initialMessages?: readonly QueuedMessageItem[];
  initialGroupSize?: number;
}

export function QueuedMessageGroupingDemo({
  initialMessages = DEFAULT_QUEUE,
  initialGroupSize = 1,
}: QueuedMessageGroupingDemoProps) {
  const [messages, setMessages] = useState<QueuedMessageItem[]>([
    ...initialMessages,
  ]);
  const [groupSize, setGroupSize] = useState(
    Math.min(Math.max(initialGroupSize, 1), Math.max(initialMessages.length, 1)),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // One handler for both gestures: rebuild the combined [rows + divider] order
  // after the move, then read the new message order and group boundary back out
  // of it. Dragging the divider repositions the boundary; dragging a row across
  // the divider both reorders and re-groups.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const groupCount = Math.min(groupSize, messages.length);
      const ids = messages.map((message) => message.id);
      const combined =
        messages.length >= 2
          ? [...ids.slice(0, groupCount), DIVIDER_ID, ...ids.slice(groupCount)]
          : ids;

      const oldIndex = combined.indexOf(String(active.id));
      const newIndex = combined.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      const moved = arrayMove(combined, oldIndex, newIndex);
      const byId = new Map(messages.map((message) => [message.id, message]));
      const nextMessages: QueuedMessageItem[] = [];
      for (const id of moved) {
        if (id === DIVIDER_ID) continue;
        const message = byId.get(id);
        if (message) nextMessages.push(message);
      }
      setMessages(nextMessages);

      const dividerIndex = moved.indexOf(DIVIDER_ID);
      if (dividerIndex !== -1) {
        // The divider can't sit above the first message — the group always
        // includes it.
        setGroupSize(Math.max(dividerIndex, 1));
      }
    },
    [messages, groupSize],
  );

  const handleDelete = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  // Editing would load the message back into the composer; the prototype has no
  // composer, so this is a no-op (matching the static QueuedMessagesList story).
  const handleEdit = useCallback(() => {}, []);

  // "Send now" simulates dispatching that message — drop it from the queue.
  const handleSend = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  if (messages.length === 0) {
    return (
      <PromptStackCard ariaLabel="Queued messages">
        <div className="px-3 py-3 text-xs text-muted-foreground">
          Queue is empty — every message has been sent.
        </div>
      </PromptStackCard>
    );
  }

  const groupCount = Math.min(groupSize, messages.length);
  const showDivider = messages.length >= 2;
  const ids = messages.map((message) => message.id);
  const combinedIds = showDivider
    ? [...ids.slice(0, groupCount), DIVIDER_ID, ...ids.slice(groupCount)]
    : ids;
  const byId = new Map(messages.map((message) => [message.id, message]));

  return (
    <PromptStackCard ariaLabel="Queued messages" className="overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-xs text-muted-foreground">
        <span className="opacity-70">Queued</span>
        <span className="text-2xs text-subtle-foreground">{messages.length}</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={combinedIds}
          strategy={verticalListSortingStrategy}
        >
          <ul className="relative pb-1">
            {combinedIds.map((id) => {
              if (id === DIVIDER_ID) {
                return <SortableDivider key={id} />;
              }
              const message = byId.get(id);
              if (!message) return null;
              const index = ids.indexOf(id);
              return (
                <SortableQueuedRow
                  key={id}
                  message={message}
                  index={index}
                  reorderDisabled={messages.length < 2}
                  onSend={handleSend}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </PromptStackCard>
  );
}

export const DEFAULT_QUEUE: readonly QueuedMessageItem[] = [
  { id: "q1", text: "Add the table-of-contents rail to ThreadDetailView" },
  {
    id: "q2",
    text: "Then write a regression test for the scroll-spy active tracking",
    attachments: 1,
  },
  { id: "q3", text: "Run typecheck and the timeline tests" },
  { id: "q4", text: "Open a draft PR and summarize the diff for review" },
  { id: "q5", text: "Ping me on Slack when CI goes green" },
];

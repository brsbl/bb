import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
} from "react";
import { flushSync } from "react-dom";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ThreadListEntry } from "@bb/domain";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
  type NeighborReorderRequest,
} from "@/lib/neighbor-reorder";
import { cn } from "@/lib/utils";
import {
  ThreadRow,
  type ThreadRowDragBindings,
  type ThreadRowOptions,
} from "./ThreadRow";
import { ManagerThreadGroupRow } from "./ProjectRow";
import { SIDEBAR_SORTABLE_TRANSITION } from "./sortableMotion";
import type { PinnedSidebarRootItem } from "./pinnedSidebarThreads";
import { useDragClickSuppression } from "./useDragClickSuppression";

export interface PinnedThreadRootReorderCallbacks {
  onSettled: () => void;
}

export interface PinnedThreadTreeProps {
  rootItems: readonly PinnedSidebarRootItem[];
  selectedThreadId?: string;
  collapsedManagerIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleManagerCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  isPinnedReorderPending?: boolean;
  onReorderPinnedRoot?: (
    request: NeighborReorderRequest,
    callbacks: PinnedThreadRootReorderCallbacks,
  ) => void;
}

interface PinnedRootOrderEntry {
  id: string;
}

type PinnedRootDragBindings = ThreadRowDragBindings;

interface PinnedThreadRootRowProps {
  dragBindings?: PinnedRootDragBindings;
  isDragging?: boolean;
  onProjectSelect?: () => void;
  rootRef?: (element: HTMLDivElement | null) => void;
  rootStyle?: CSSProperties;
  selectedThreadId?: string;
  thread: ThreadListEntry;
}

interface SortablePinnedRootItemProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedManagerIds: Set<string>;
  disabled: boolean;
  item: PinnedSidebarRootItem;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onToggleManagerCollapsed: (threadId: string) => void;
  selectedThreadId?: string;
}

interface PinnedRootItemProps extends Omit<
  SortablePinnedRootItemProps,
  "disabled"
> {
  consumeClickSuppression?: () => boolean;
}

type PinnedThreadTreeClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const PINNED_THREAD_ROOT_OPTIONS: ThreadRowOptions = {
  kind: "default",
  indent: "root",
};

function getPinnedRootItemId(item: PinnedSidebarRootItem): string {
  return item.kind === "thread" ? item.thread.id : item.group.managerThread.id;
}

function hasSamePinnedRootOrder(
  order: readonly PinnedRootOrderEntry[],
  rootItems: readonly PinnedSidebarRootItem[],
): boolean {
  if (order.length !== rootItems.length) {
    return false;
  }
  return order.every(
    (item, index) => item.id === getPinnedRootItemId(rootItems[index]),
  );
}

function PinnedThreadRootRow({
  dragBindings,
  isDragging = false,
  onProjectSelect,
  rootRef,
  rootStyle,
  selectedThreadId,
  thread,
}: PinnedThreadRootRowProps) {
  return (
    <div
      ref={rootRef}
      style={rootStyle}
      className={cn(isDragging && "relative z-20")}
      {...dragBindings?.attributes}
      {...(dragBindings?.listeners ?? {})}
    >
      <ThreadRow
        projectId={thread.projectId}
        thread={thread}
        isActive={selectedThreadId === thread.id}
        onProjectSelect={onProjectSelect}
        options={PINNED_THREAD_ROOT_OPTIONS}
      />
    </div>
  );
}

const PinnedRootItem = memo(function PinnedRootItem({
  collapsedEnvironmentIds,
  collapsedManagerIds,
  consumeClickSuppression,
  item,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleManagerCollapsed,
  selectedThreadId,
}: PinnedRootItemProps) {
  if (item.kind === "thread") {
    return (
      <PinnedThreadRootRow
        thread={item.thread}
        selectedThreadId={selectedThreadId}
        onProjectSelect={onProjectSelect}
      />
    );
  }

  return (
    <ManagerThreadGroupRow
      projectId={item.group.managerThread.projectId}
      managerThreadGroup={item.group}
      selectedThreadId={selectedThreadId}
      variant="section"
      isManagerCollapsed={collapsedManagerIds.has(item.group.managerThread.id)}
      collapsedManagerIds={collapsedManagerIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleManagerCollapsed={onToggleManagerCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      consumeClickSuppression={consumeClickSuppression}
    />
  );
});

const SortablePinnedRootItem = memo(function SortablePinnedRootItem({
  collapsedEnvironmentIds,
  collapsedManagerIds,
  disabled,
  item,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleManagerCollapsed,
  selectedThreadId,
}: SortablePinnedRootItemProps) {
  const itemId = getPinnedRootItemId(item);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: itemId,
    disabled,
    transition: SIDEBAR_SORTABLE_TRANSITION,
  });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );
  const dragBindings = useMemo<PinnedRootDragBindings>(
    () => ({
      attributes,
      disabled,
      listeners,
      setActivatorNodeRef,
    }),
    [attributes, disabled, listeners, setActivatorNodeRef],
  );

  if (item.kind === "thread") {
    return (
      <PinnedThreadRootRow
        dragBindings={dragBindings}
        isDragging={isDragging}
        onProjectSelect={onProjectSelect}
        rootRef={setNodeRef}
        rootStyle={style}
        selectedThreadId={selectedThreadId}
        thread={item.thread}
      />
    );
  }

  return (
    <ManagerThreadGroupRow
      projectId={item.group.managerThread.projectId}
      managerThreadGroup={item.group}
      selectedThreadId={selectedThreadId}
      variant="section"
      isManagerCollapsed={collapsedManagerIds.has(item.group.managerThread.id)}
      collapsedManagerIds={collapsedManagerIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleManagerCollapsed={onToggleManagerCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      dragBindings={dragBindings}
      sortableRef={setNodeRef}
      sortableStyle={style}
      isDragging={isDragging}
    />
  );
});

export const PinnedThreadTree = memo(function PinnedThreadTree({
  rootItems,
  selectedThreadId,
  collapsedManagerIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleManagerCollapsed,
  onToggleEnvironmentCollapsed,
  isPinnedReorderPending = false,
  onReorderPinnedRoot,
}: PinnedThreadTreeProps) {
  const [optimisticPinnedRootOrder, setOptimisticPinnedRootOrder] = useState<
    PinnedRootOrderEntry[] | null
  >(null);
  const renderedRootItems = useMemo(() => {
    if (!optimisticPinnedRootOrder) {
      return rootItems;
    }
    const itemsById = new Map(
      rootItems.map((item) => [getPinnedRootItemId(item), item]),
    );
    const orderedItems: PinnedSidebarRootItem[] = [];
    for (const item of optimisticPinnedRootOrder) {
      const rootItem = itemsById.get(item.id);
      if (!rootItem) {
        return rootItems;
      }
      orderedItems.push(rootItem);
    }
    return orderedItems;
  }, [optimisticPinnedRootOrder, rootItems]);
  const renderedRootItemIds = useMemo(
    () => renderedRootItems.map(getPinnedRootItemId),
    [renderedRootItems],
  );
  const reorderDisabled =
    isPinnedReorderPending ||
    !onReorderPinnedRoot ||
    renderedRootItems.length < 2;
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragStart = useCallback(
    (_event: DragStartEvent) => {
      beginDragClickSuppression();
    },
    [beginDragClickSuppression],
  );
  const handleDragCancel = useCallback(() => {
    clearDragClickSuppressionSoon();
  }, [clearDragClickSuppressionSoon]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragClickSuppressionSoon();
      if (isPinnedReorderPending) {
        return;
      }
      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: renderedRootItems.map((item) => ({
          id: getPinnedRootItemId(item),
        })),
      });
      if (!request) {
        return;
      }
      const nextOrder = applyNeighborReorder({
        items: renderedRootItems.map((item) => ({
          id: getPinnedRootItemId(item),
        })),
        request,
      });
      flushSync(() => {
        setOptimisticPinnedRootOrder(nextOrder);
      });
      onReorderPinnedRoot?.(request, {
        onSettled: () => {
          setOptimisticPinnedRootOrder(null);
        },
      });
    },
    [
      clearDragClickSuppressionSoon,
      isPinnedReorderPending,
      onReorderPinnedRoot,
      renderedRootItems,
    ],
  );
  useEffect(() => {
    if (!optimisticPinnedRootOrder) {
      return;
    }
    if (hasSamePinnedRootOrder(optimisticPinnedRootOrder, rootItems)) {
      setOptimisticPinnedRootOrder(null);
    }
  }, [optimisticPinnedRootOrder, rootItems]);
  const handleClickCapture = useCallback<PinnedThreadTreeClickCaptureHandler>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );

  if (renderedRootItems.length === 0) {
    return null;
  }

  return (
    <div
      data-sidebar-sticky-section=""
      className="relative space-y-0.5 group-data-[collapsible=icon]:hidden"
      onClickCapture={handleClickCapture}
    >
      {renderedRootItems.length > 1 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={renderedRootItemIds}
            strategy={verticalListSortingStrategy}
          >
            {renderedRootItems.map((item) => (
              <SortablePinnedRootItem
                key={getPinnedRootItemId(item)}
                item={item}
                disabled={reorderDisabled}
                selectedThreadId={selectedThreadId}
                collapsedManagerIds={collapsedManagerIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                onProjectSelect={onProjectSelect}
                onToggleManagerCollapsed={onToggleManagerCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        renderedRootItems.map((item) => (
          <PinnedRootItem
            key={getPinnedRootItemId(item)}
            item={item}
            selectedThreadId={selectedThreadId}
            collapsedManagerIds={collapsedManagerIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            onProjectSelect={onProjectSelect}
            onToggleManagerCollapsed={onToggleManagerCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            consumeClickSuppression={consumeDragClickSuppression}
          />
        ))
      )}
    </div>
  );
});

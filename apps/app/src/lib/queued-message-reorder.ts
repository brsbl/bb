import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
} from "./neighbor-reorder";

export interface QueuedMessageReorderItem {
  id: string;
}

export interface QueuedMessageReorderRequest {
  groupBoundaryQueuedMessageId?: string;
  nextQueuedMessageId: string | null;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
}

export interface BuildQueuedMessageReorderRequestArgs<
  Item extends QueuedMessageReorderItem,
> {
  activeId: string;
  groupBoundaryQueuedMessageId?: string;
  overId: string;
  queuedMessages: readonly Item[];
}

export interface ApplyQueuedMessageReorderArgs<
  Item extends QueuedMessageReorderItem,
> {
  queuedMessages: readonly Item[];
  request: QueuedMessageReorderRequest;
}

export function buildQueuedMessageReorderRequest<
  Item extends QueuedMessageReorderItem,
>({
  activeId,
  groupBoundaryQueuedMessageId,
  overId,
  queuedMessages,
}: BuildQueuedMessageReorderRequestArgs<Item>): QueuedMessageReorderRequest | null {
  const request = buildNeighborReorderRequest({
    activeId,
    items: queuedMessages,
    overId,
  });
  if (!request) {
    return null;
  }

  return {
    ...(groupBoundaryQueuedMessageId !== undefined
      ? { groupBoundaryQueuedMessageId }
      : {}),
    queuedMessageId: request.itemId,
    previousQueuedMessageId: request.previousItemId,
    nextQueuedMessageId: request.nextItemId,
  };
}

export function applyQueuedMessageReorder<
  Item extends QueuedMessageReorderItem,
>({ queuedMessages, request }: ApplyQueuedMessageReorderArgs<Item>): Item[] {
  return applyNeighborReorder({
    items: queuedMessages,
    request: {
      itemId: request.queuedMessageId,
      previousItemId: request.previousQueuedMessageId,
      nextItemId: request.nextQueuedMessageId,
    },
  });
}

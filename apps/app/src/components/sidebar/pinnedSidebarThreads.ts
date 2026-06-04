import type { ThreadListEntry } from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import { getCollapsedChildActivity } from "@/lib/thread-activity";
import {
  buildProjectThreadGroups,
  type ManagerThreadGroup,
} from "./projectThreadGroups";

export type PinnedSidebarRootItem =
  | { kind: "thread"; thread: ThreadListEntry }
  | { kind: "manager"; group: ManagerThreadGroup };

export interface PinnedSidebarState {
  effectivePinnedThreadIds: Set<string>;
  rootItems: PinnedSidebarRootItem[];
}

interface BuildPinnedSidebarStateArgs {
  threads: readonly ThreadListEntry[];
}

interface BuildPinnedManagerGroupArgs {
  descendants: readonly ThreadListEntry[];
  managerThread: ThreadListEntry;
}

interface CollectManagedDescendantsArgs {
  childrenByManagerId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  managerThreadId: string;
  visitedManagerIds: ReadonlySet<string>;
}

interface HasPinnedManagerAncestorArgs {
  pinnedManagerThreadIds: ReadonlySet<string>;
  thread: ThreadListEntry;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}

function compareByPinnedFallback(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const pinnedAtDelta = (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
  if (pinnedAtDelta !== 0) {
    return pinnedAtDelta;
  }

  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function comparePinnedRoots(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  if (left.pinSortKey !== null && right.pinSortKey !== null) {
    const pinSortKeyDelta = compareCodepoint(left.pinSortKey, right.pinSortKey);
    if (pinSortKeyDelta !== 0) {
      return pinSortKeyDelta;
    }
  }

  return compareByPinnedFallback(left, right);
}

function buildPinnedManagerGroup({
  descendants,
  managerThread,
}: BuildPinnedManagerGroupArgs): ManagerThreadGroup {
  const groups = buildProjectThreadGroups([managerThread, ...descendants]);
  const group = groups.managerThreadGroups[0];
  if (group) {
    return group;
  }

  return {
    managerThread,
    managedItems: [],
    stats: {
      managedChildActivity: getCollapsedChildActivity([]),
      managedChildCount: 0,
    },
  };
}

function collectManagedDescendants({
  childrenByManagerId,
  managerThreadId,
  visitedManagerIds,
}: CollectManagedDescendantsArgs): ThreadListEntry[] {
  if (visitedManagerIds.has(managerThreadId)) {
    return [];
  }

  const nextVisitedManagerIds = new Set(visitedManagerIds);
  nextVisitedManagerIds.add(managerThreadId);
  const descendants: ThreadListEntry[] = [];

  for (const child of childrenByManagerId.get(managerThreadId) ?? []) {
    descendants.push(child);
    if (child.type === "manager") {
      descendants.push(
        ...collectManagedDescendants({
          childrenByManagerId,
          managerThreadId: child.id,
          visitedManagerIds: nextVisitedManagerIds,
        }),
      );
    }
  }

  return descendants;
}

function hasPinnedManagerAncestor({
  pinnedManagerThreadIds,
  thread,
  threadsById,
}: HasPinnedManagerAncestorArgs): boolean {
  const visitedThreadIds = new Set<string>();
  let parentThreadId = thread.parentThreadId;

  while (parentThreadId !== null) {
    if (visitedThreadIds.has(parentThreadId)) {
      return false;
    }
    if (pinnedManagerThreadIds.has(parentThreadId)) {
      return true;
    }

    visitedThreadIds.add(parentThreadId);
    parentThreadId = threadsById.get(parentThreadId)?.parentThreadId ?? null;
  }

  return false;
}

export function buildPinnedSidebarState({
  threads,
}: BuildPinnedSidebarStateArgs): PinnedSidebarState {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const explicitlyPinnedThreads = threads.filter(
    (thread) => thread.pinnedAt !== null,
  );
  const pinnedManagerThreadIds = new Set(
    explicitlyPinnedThreads
      .filter((thread) => thread.type === "manager")
      .map((thread) => thread.id),
  );
  const childrenByManagerId = new Map<string, ThreadListEntry[]>();

  for (const thread of threads) {
    if (thread.parentThreadId === null) {
      continue;
    }
    const managerChildren = childrenByManagerId.get(thread.parentThreadId);
    if (managerChildren) {
      managerChildren.push(thread);
      continue;
    }
    childrenByManagerId.set(thread.parentThreadId, [thread]);
  }

  const effectivePinnedThreadIds = new Set(
    explicitlyPinnedThreads.map((thread) => thread.id),
  );
  for (const managerThreadId of pinnedManagerThreadIds) {
    for (const descendant of collectManagedDescendants({
      childrenByManagerId,
      managerThreadId,
      visitedManagerIds: new Set(),
    })) {
      effectivePinnedThreadIds.add(descendant.id);
    }
  }

  const visiblePinnedRoots = explicitlyPinnedThreads
    .filter(
      (thread) =>
        !hasPinnedManagerAncestor({
          pinnedManagerThreadIds,
          thread,
          threadsById,
        }),
    )
    .sort(comparePinnedRoots);

  return {
    effectivePinnedThreadIds,
    rootItems: visiblePinnedRoots.map((thread) =>
      thread.type === "manager"
        ? {
            kind: "manager",
            group: buildPinnedManagerGroup({
              descendants: collectManagedDescendants({
                childrenByManagerId,
                managerThreadId: thread.id,
                visitedManagerIds: new Set(),
              }),
              managerThread: thread,
            }),
          }
        : { kind: "thread", thread },
    ),
  };
}

import type {
  EnvironmentWorkspaceDisplayKind,
  ThreadListEntry,
} from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";

export interface ManagerThreadStats {
  managedChildCount: number;
  managedChildActivity: CollapsedChildActivity;
}

export interface EnvironmentThreadGroup {
  environmentId: string;
  threads: ThreadListEntry[];
}

// A single render slot in a project's or manager's thread list. Threads and
// env groups interleave by recency, so the renderer iterates one ordered list
// rather than two parallel arrays.
export type ProjectThreadItem =
  | { kind: "thread"; thread: ThreadListEntry }
  | { kind: "environment"; group: EnvironmentThreadGroup }
  | { kind: "manager"; group: ManagerThreadGroup };

export interface ManagerThreadGroup {
  managerThread: ThreadListEntry;
  managedItems: ProjectThreadItem[];
  stats: ManagerThreadStats;
}

export interface ProjectThreadGroups {
  managerThreadGroups: ManagerThreadGroup[];
  unmanagedItems: ProjectThreadItem[];
}

type WorktreeDisplayKind = "managed-worktree" | "unmanaged-worktree";

function isWorktreeDisplayKind(
  kind: EnvironmentWorkspaceDisplayKind,
): kind is WorktreeDisplayKind {
  return kind === "managed-worktree" || kind === "unmanaged-worktree";
}

interface KnownManagerParentArgs {
  managerThreadIds: ReadonlySet<string>;
  thread: ThreadListEntry;
}

interface BuildManagerThreadGroupArgs {
  childrenByManagerId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  managerThread: ThreadListEntry;
  visitedManagerIds: ReadonlySet<string>;
}

interface BuildSortedProjectThreadItemsArgs {
  childrenByManagerId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  threads: readonly ThreadListEntry[];
  visitedManagerIds: ReadonlySet<string>;
}

function compareByCreatedAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function compareByLatestAttentionAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  return compareByCreatedAtDescending(left, right);
}

function compareStandardThreads(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  // Use durable thread.status for the active bucket, not ephemeral runtime
  // display state. Active rows stream frequent updates, so pin their position
  // to createdAt; inactive rows use attention recency so read/archive metadata
  // updates do not reshuffle the sidebar.
  const leftIsActive = left.status === "active";
  const rightIsActive = right.status === "active";

  if (leftIsActive !== rightIsActive) {
    return leftIsActive ? -1 : 1;
  }

  if (leftIsActive) {
    return compareByCreatedAtDescending(left, right);
  }

  return compareByLatestAttentionAtDescending(left, right);
}

function representativeThread(item: ProjectThreadItem): ThreadListEntry {
  if (item.kind === "thread") return item.thread;
  if (item.kind === "manager") return item.group.managerThread;
  return item.group.threads[0];
}

function compareProjectThreadItems(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
): number {
  return compareStandardThreads(
    representativeThread(left),
    representativeThread(right),
  );
}

function buildSortedItems(
  threads: readonly ThreadListEntry[],
): ProjectThreadItem[] {
  const { environmentThreadGroups, looseThreads } =
    bucketWorktreeEnvironmentGroups(threads);
  const items: ProjectThreadItem[] = [
    ...looseThreads.map((thread) => ({ kind: "thread" as const, thread })),
    ...environmentThreadGroups.map((group) => ({
      kind: "environment" as const,
      group,
    })),
  ];
  items.sort(compareProjectThreadItems);
  return items;
}

function getKnownManagerParentId({
  managerThreadIds,
  thread,
}: KnownManagerParentArgs): string | null {
  if (thread.parentThreadId === null) return null;
  if (thread.parentThreadId === thread.id) return null;
  if (!managerThreadIds.has(thread.parentThreadId)) return null;

  return thread.parentThreadId;
}

function buildSortedProjectThreadItems({
  childrenByManagerId,
  threads,
  visitedManagerIds,
}: BuildSortedProjectThreadItemsArgs): ProjectThreadItem[] {
  const leafThreads: ThreadListEntry[] = [];
  const managerItems: ProjectThreadItem[] = [];

  for (const thread of threads) {
    if (thread.type !== "manager") {
      leafThreads.push(thread);
      continue;
    }

    if (visitedManagerIds.has(thread.id)) {
      leafThreads.push(thread);
      continue;
    }

    managerItems.push({
      kind: "manager",
      group: buildManagerThreadGroup({
        childrenByManagerId,
        managerThread: thread,
        visitedManagerIds,
      }),
    });
  }

  const items = [...buildSortedItems(leafThreads), ...managerItems];
  items.sort(compareProjectThreadItems);
  return items;
}

function buildManagerThreadGroup({
  childrenByManagerId,
  managerThread,
  visitedManagerIds,
}: BuildManagerThreadGroupArgs): ManagerThreadGroup {
  const nextVisitedManagerIds = new Set(visitedManagerIds);
  nextVisitedManagerIds.add(managerThread.id);
  const children = childrenByManagerId.get(managerThread.id) ?? [];

  return {
    managerThread,
    managedItems: buildSortedProjectThreadItems({
      childrenByManagerId,
      threads: children,
      visitedManagerIds: nextVisitedManagerIds,
    }),
    stats: {
      managedChildCount: children.length,
      managedChildActivity: getCollapsedChildActivity(children),
    },
  };
}

export function buildProjectThreadGroups(
  projectThreads: ThreadListEntry[],
): ProjectThreadGroups {
  const managerThreads = projectThreads.filter(
    (thread) => thread.type === "manager",
  );
  const managerThreadIds = new Set(managerThreads.map((thread) => thread.id));
  const childrenByManagerId = new Map<string, ThreadListEntry[]>();
  const unmanagedStandardThreads: ThreadListEntry[] = [];

  for (const managerThread of managerThreads) {
    childrenByManagerId.set(managerThread.id, []);
  }

  for (const thread of projectThreads) {
    const managerId = getKnownManagerParentId({ managerThreadIds, thread });
    if (managerId !== null) {
      childrenByManagerId.get(managerId)?.push(thread);
      continue;
    }

    if (thread.type === "standard") {
      unmanagedStandardThreads.push(thread);
    }
  }

  const rootManagerThreads = managerThreads.filter(
    (managerThread) =>
      getKnownManagerParentId({
        managerThreadIds,
        thread: managerThread,
      }) === null,
  );

  return {
    managerThreadGroups: rootManagerThreads.map((managerThread) =>
      buildManagerThreadGroup({
        childrenByManagerId,
        managerThread,
        visitedManagerIds: new Set(),
      }),
    ),
    unmanagedItems: buildSortedItems(unmanagedStandardThreads),
  };
}

interface BucketWorktreeEnvironmentGroupsResult {
  environmentThreadGroups: EnvironmentThreadGroup[];
  looseThreads: ThreadListEntry[];
}

// Bucket threads by shared worktree environmentId. A bucket only becomes a
// group when ≥2 threads share the environment; solo threads stay loose so
// we don't render degenerate 1-thread groups. Callers pass standard threads
// that are siblings in the same render context (project-level or under a
// single manager).
function bucketWorktreeEnvironmentGroups(
  threads: readonly ThreadListEntry[],
): BucketWorktreeEnvironmentGroupsResult {
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  for (const thread of threads) {
    if (thread.environmentId === null) continue;
    if (!isWorktreeDisplayKind(thread.environmentWorkspaceDisplayKind))
      continue;
    let bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (!bucket) {
      bucket = [];
      threadsByEnvironmentId.set(thread.environmentId, bucket);
    }
    bucket.push(thread);
  }

  const groupedEnvironmentIds = new Set<string>();
  const environmentThreadGroups: EnvironmentThreadGroup[] = [];
  for (const [environmentId, bucket] of threadsByEnvironmentId) {
    if (bucket.length < 2) continue;
    bucket.sort(compareStandardThreads);
    groupedEnvironmentIds.add(environmentId);
    environmentThreadGroups.push({ environmentId, threads: bucket });
  }

  const looseThreads = threads.filter(
    (thread) =>
      thread.environmentId === null ||
      !groupedEnvironmentIds.has(thread.environmentId),
  );
  looseThreads.sort(compareStandardThreads);

  return { environmentThreadGroups, looseThreads };
}

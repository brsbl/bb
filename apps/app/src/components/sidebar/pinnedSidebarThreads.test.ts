import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildPinnedSidebarState } from "./pinnedSidebarThreads";
import type { ProjectThreadItem } from "./projectThreadGroups";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

function createThread(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Thread",
    titleFallback: "Thread",
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

type ManagedItemSummary =
  | string
  | { env: string; threads: string[] }
  | { manager: string; items: ManagedItemSummary[] };

function summarizeManagedItems(
  items: readonly ProjectThreadItem[],
): ManagedItemSummary[] {
  return items.map((item) => {
    if (item.kind === "thread") {
      return item.thread.id;
    }
    if (item.kind === "manager") {
      return {
        manager: item.group.managerThread.id,
        items: summarizeManagedItems(item.group.managedItems),
      };
    }
    return {
      env: item.group.environmentId,
      threads: item.group.threads.map((thread) => thread.id),
    };
  });
}

describe("buildPinnedSidebarState", () => {
  it("sorts visible pinned roots by global pin sort key", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "unpinned",
          createdAt: 4,
        }),
        createThread({
          id: "pinned-late",
          pinnedAt: 1_000,
          pinSortKey: "b",
        }),
        createThread({
          id: "pinned-early",
          pinnedAt: 2_000,
          pinSortKey: "a",
        }),
      ],
    });

    expect(
      state.rootItems.map((item) =>
        item.kind === "thread" ? item.thread.id : item.group.managerThread.id,
      ),
    ).toEqual(["pinned-early", "pinned-late"]);
    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "pinned-early",
      "pinned-late",
    ]);
  });

  it("orders pin sort keys by codepoint, not locale", () => {
    // The fractional-index keys are collated by codepoint on the server and by
    // the key generator. `localeCompare` would order "a" before "Z"; codepoint
    // (matching the server) orders "Z" (0x5A) before "a" (0x61).
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "pinned-lower",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "pinned-upper",
          pinnedAt: 2_000,
          pinSortKey: "Z",
        }),
      ],
    });

    expect(
      state.rootItems.map((item) =>
        item.kind === "thread" ? item.thread.id : item.group.managerThread.id,
      ),
    ).toEqual(["pinned-upper", "pinned-lower"]);
  });

  it("moves manager children with a pinned manager", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "manager",
          type: "manager",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "child",
          parentThreadId: "manager",
        }),
        createThread({
          id: "root",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "child",
      "manager",
    ]);
    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "manager") {
      throw new Error("Expected pinned manager root item");
    }
    expect(item.group.managerThread.id).toBe("manager");
    expect(item.group.stats.managedChildCount).toBe(1);
  });

  it("renders an explicitly pinned child as a root only when its manager is not pinned", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "manager",
          type: "manager",
        }),
        createThread({
          id: "child",
          parentThreadId: "manager",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
      ],
    });

    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "thread") {
      throw new Error("Expected pinned child root item");
    }
    expect(item.thread.id).toBe("child");
  });

  it("hides an explicitly pinned child under its pinned manager root", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "manager",
          type: "manager",
          pinnedAt: 2_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "child",
          parentThreadId: "manager",
          pinnedAt: 1_000,
          pinSortKey: "b",
        }),
      ],
    });

    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "manager") {
      throw new Error("Expected pinned manager root item");
    }
    expect(item.group.managerThread.id).toBe("manager");
    expect(item.group.stats.managedChildCount).toBe(1);
  });

  it("keeps an explicitly pinned manager child under its pinned manager root", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "parent-manager",
          type: "manager",
          pinnedAt: 2_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "child-manager",
          type: "manager",
          parentThreadId: "parent-manager",
          pinnedAt: 1_000,
          pinSortKey: "b",
        }),
        createThread({
          id: "nested-standard",
          parentThreadId: "child-manager",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "child-manager",
      "nested-standard",
      "parent-manager",
    ]);
    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "manager") {
      throw new Error("Expected pinned manager root item");
    }
    expect(item.group.managerThread.id).toBe("parent-manager");
    expect(summarizeManagedItems(item.group.managedItems)).toEqual([
      { manager: "child-manager", items: ["nested-standard"] },
    ]);
  });
});

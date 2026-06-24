import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import {
  makeProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { Icon } from "@/components/ui/icon.js";
import {
  ProjectList,
  ProjectListActionButtons,
  ProjectListNavigationLoadingState,
  ProjectListShell,
} from "@/components/sidebar/ProjectList";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import {
  DEMO_CONVERSATION,
  ThreadTocDemo,
  type TocConversationMessage,
} from "./ThreadTableOfContents";

export default { title: "Prototypes/Thread Table of Contents" };

const noop = () => {};
const SIDEBAR_NAVIGATION_STORY_QUERY_KEY = sidebarNavigationQueryKey();

function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="mx-6 mb-3 mt-6 max-w-3xl text-sm text-muted-foreground">
      {children}
    </p>
  );
}

const SHORT_CONVERSATION: readonly TocConversationMessage[] = [
  {
    id: "s1",
    role: "user",
    text: "Quick one — what does the bottom-anchored scroll body do?",
  },
  {
    id: "s2",
    role: "assistant",
    text: "It keeps the thread pinned to the latest message while letting you scroll up freely, and exposes a scrollElementIntoView helper for jump-to-message.",
  },
  {
    id: "s3",
    role: "user",
    text: "Got it, thanks.",
  },
];

// --- Real app sidebar, seeded with mock navigation data ----------------------
// Mirrors the recipe in Sidebar/Overview: seed the sidebar navigation query,
// wrap in the project/thread action providers, and render the real ProjectList.

const bbProject = makeProject({ id: "proj_story_bb", name: "bb" });
const personalProject = makeProject({
  id: PERSONAL_PROJECT_ID,
  kind: "personal",
  name: "Personal",
});

const loadedSidebarNavigation = {
  personalProject: {
    ...personalProject,
    defaultExecutionOptions: null,
    threads: [
      makeThreadListEntry({
        id: "thr_toc_personal",
        projectId: PERSONAL_PROJECT_ID,
        title: "Sketch launch checklist",
        titleFallback: "Sketch launch checklist",
        latestAttentionAt: 90,
        createdAt: 90,
        updatedAt: 90,
      }),
    ],
  },
  projects: [
    {
      ...bbProject,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({
          id: "thr_toc_active",
          projectId: bbProject.id,
          title: "Prototype thread table of contents",
          titleFallback: "Prototype thread table of contents",
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
          latestAttentionAt: 200,
          createdAt: 200,
          updatedAt: 200,
        }),
        makeThreadListEntry({
          id: "thr_toc_grouping",
          projectId: bbProject.id,
          title: "Group queued messages into one turn",
          titleFallback: "Group queued messages into one turn",
          latestAttentionAt: 190,
          createdAt: 190,
          updatedAt: 190,
        }),
        makeThreadListEntry({
          id: "thr_toc_flicker",
          projectId: bbProject.id,
          title: "Fix scroll-to-bottom button flicker",
          titleFallback: "Fix scroll-to-bottom button flicker",
          latestAttentionAt: 180,
          createdAt: 180,
          updatedAt: 180,
        }),
        makeThreadListEntry({
          id: "thr_toc_tests",
          projectId: bbProject.id,
          title: "Audit timeline regression tests",
          titleFallback: "Audit timeline regression tests",
          latestAttentionAt: 170,
          createdAt: 170,
          updatedAt: 170,
        }),
      ],
    },
  ],
} satisfies SidebarBootstrapResponse;

function LoadingSidebar() {
  return (
    <ProjectListShell>
      <ProjectListNavigationLoadingState />
    </ProjectListShell>
  );
}

function AppSidebarColumn() {
  const queryClient = useQueryClient();
  const [isSeeded, setIsSeeded] = useState(false);

  useEffect(() => {
    queryClient.setQueryData(
      SIDEBAR_NAVIGATION_STORY_QUERY_KEY,
      loadedSidebarNavigation,
    );
    setIsSeeded(true);
    return () => {
      queryClient.removeQueries({
        queryKey: SIDEBAR_NAVIGATION_STORY_QUERY_KEY,
        exact: true,
      });
    };
  }, [queryClient]);

  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="shrink-0 px-2 py-2">
            <ProjectListActionButtons onNewChat={noop} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isSeeded ? (
              <Suspense fallback={<LoadingSidebar />}>
                <ProjectList onNewProject={noop} onProjectSelect={noop} />
              </Suspense>
            ) : (
              <LoadingSidebar />
            )}
          </div>
          <div className="shrink-0 border-t border-sidebar-border/70 px-2 py-2">
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
            >
              <Icon name="Settings" className="size-4" />
            </button>
          </div>
        </div>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

// --- Per-thread conversations -----------------------------------------------
// Each sidebar thread maps to a distinct conversation so selecting a thread
// visibly changes the timeline — and the TOC rail along with it.

const A_REPLY =
  "Here's what I found — the change is small and contained. I confirmed the data shape at the boundary and added a focused test that would have failed before.";
const B_REPLY =
  "Done. I ran the affected tests and they pass. Want me to widen the scope, or keep it minimal and open a draft PR?";

function convo(
  threadId: string,
  prompts: readonly string[],
): TocConversationMessage[] {
  const messages: TocConversationMessage[] = [];
  prompts.forEach((text, index) => {
    messages.push({ id: `${threadId}-u${index}`, role: "user", text });
    messages.push({
      id: `${threadId}-a${index}`,
      role: "assistant",
      text: index % 2 === 0 ? A_REPLY : B_REPLY,
    });
  });
  return messages;
}

const CONVERSATIONS: Record<string, readonly TocConversationMessage[]> = {
  thr_toc_active: DEMO_CONVERSATION,
  thr_toc_grouping: convo("grouping", [
    "Let's add a way to group queued messages into one turn",
    "Should the divider snap between rows, or move freely?",
    "Give the grouped messages a shared highlight — no left border",
    "Now strip the helper text and ship it",
  ]),
  thr_toc_flicker: convo("flicker", [
    "The scroll-to-bottom button flickers when a turn streams in",
    "Can we debounce the visibility toggle?",
    "Add a test that reproduces the flicker",
  ]),
  thr_toc_tests: convo("tests", [
    "Audit the timeline regression tests for gaps",
    "Which suites are flaky on CI right now?",
    "Stabilize the tsx provider timeout",
    "Add coverage for the unread divider",
    "Summarize what changed for the PR",
  ]),
  thr_toc_personal: convo("personal", [
    "Help me sketch a launch checklist",
    "Add a rollback step at the end",
  ]),
};

/**
 * In context: the real app sidebar on the left, the open thread on the right.
 * Click any thread in the sidebar to load its conversation — the timeline and
 * the TOC rail update to that thread (and the row highlights, since the real
 * ProjectList reads the selected thread from the route).
 */
function ThreadTocWithSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const selectedThreadId = useMemo(() => {
    const match = location.pathname.match(/\/threads\/([^/?#]+)/);
    return match?.[1] ?? null;
  }, [location.pathname]);

  // Default-select the active thread on mount so the sidebar highlights it and
  // the pane isn't empty.
  useEffect(() => {
    if (!selectedThreadId) {
      navigate(
        getThreadRoutePath({
          projectId: bbProject.id,
          threadId: "thr_toc_active",
        }),
      );
    }
  }, [selectedThreadId, navigate]);

  const conversation =
    (selectedThreadId ? CONVERSATIONS[selectedThreadId] : undefined) ??
    CONVERSATIONS.thr_toc_active;

  return (
    <div className="mx-6 flex h-[680px] gap-3 overflow-hidden">
      <AppSidebarColumn />
      {/* Remount on thread change so scroll position and active tick reset. */}
      <ThreadTocDemo
        key={selectedThreadId ?? "default"}
        messages={conversation}
        height={680}
        className="max-w-none flex-1"
      />
    </div>
  );
}

export function Overview() {
  return (
    <div className="px-6 pb-10">
      <Caption>
        Click any thread in the sidebar to load its conversation — the timeline
        and the TOC rail update to match. Hover the rail to reveal your messages;
        click one to jump; scroll and the active tick tracks the message in view.
      </Caption>
      <ThreadTocWithSidebar />
    </div>
  );
}

/**
 * The thread pane on its own, without the app sidebar — useful for inspecting
 * just the rail and its hover panel.
 */
export function RailOnly() {
  return (
    <div className="px-6 pb-10">
      <Caption>
        The rail in isolation. Hover to reveal the message list; click to jump.
      </Caption>
      <div className="px-6">
        <ThreadTocDemo />
      </div>
    </div>
  );
}

/**
 * A short thread with only a couple of user turns — the rail stays compact.
 */
export function FewMessages() {
  return (
    <div className="px-6 pb-10">
      <Caption>
        With only two user turns the rail shows two ticks. The panel still opens
        on hover.
      </Caption>
      <div className="px-6">
        <ThreadTocDemo messages={SHORT_CONVERSATION} height={360} />
      </div>
    </div>
  );
}

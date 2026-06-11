// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  PermissionMode,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
  ThreadWithRuntime,
} from "@bb/domain";
import type { AppSummary } from "@bb/server-contract";
import type { ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
import { restoreMatchMedia, setupMatchMedia } from "@/test/helpers/match-media";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

interface MockFollowUpPromptBoxProps {
  actionsMenu?: ReactNode;
  composer: {
    onSubmit: () => void | Promise<void>;
  };
  promptBoxRef?: Ref<{
    focusEnd: () => void;
    getTextBeforeCursor: () => string | undefined;
    insertTextAtCursor: (text: string) => void;
    openCommandTrigger: () => void;
  }>;
}

interface MockPromptDraft {
  attachments: readonly PromptDraftAttachment[];
  mentions: readonly PromptTextMention[];
  text: string;
  addAttachment: ReturnType<typeof vi.fn>;
  clearIfCurrentMatches: ReturnType<typeof vi.fn>;
  getCurrent: ReturnType<typeof vi.fn>;
  removeAttachment: ReturnType<typeof vi.fn>;
  restoreIfEmpty: ReturnType<typeof vi.fn>;
  setDraft: ReturnType<typeof vi.fn>;
  setTextAndMentions: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const promptDraft = {
    attachments: [],
    mentions: [],
    text: "Continue the work",
    addAttachment: vi.fn(),
    clearIfCurrentMatches: vi.fn(),
    getCurrent: vi.fn(() => ({
      attachments: [],
      mentions: [],
      text: "Continue the work",
    })),
    removeAttachment: vi.fn(),
    restoreIfEmpty: vi.fn(),
    setDraft: vi.fn(),
    setTextAndMentions: vi.fn(),
  };

  return {
    commandTriggerOpened: vi.fn(),
    createQueuedMessageMutateAsync: vi.fn(),
    deleteQueuedMessageMutateAsync: vi.fn(),
    promptDraft,
    reorderQueuedMessageMutateAsync: vi.fn(),
    sendMessageMutateAsync: vi.fn(),
    sendQueuedMessageMutateAsync: vi.fn(),
    stopThreadMutate: vi.fn(),
    threadCreationOptions: {
      supportsGoalMode: { threadStart: false, turnStart: false },
      supportsPlanMode: { threadStart: false, turnStart: false },
    },
    uploadPromptAttachmentMutateAsync: vi.fn(),
  };
});

vi.mock("@/components/promptbox/FollowUpPromptBox", async () => {
  const React = await import("react");

  return {
    FollowUpPromptBox: (props: MockFollowUpPromptBoxProps) => {
      React.useImperativeHandle(
        props.promptBoxRef,
        () => ({
          focusEnd: vi.fn(),
          getTextBeforeCursor: () => "",
          insertTextAtCursor: vi.fn(),
          openCommandTrigger: mocks.commandTriggerOpened,
        }),
        [],
      );

      return React.createElement(
        "div",
        null,
        props.actionsMenu,
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              void props.composer.onSubmit();
            },
          },
          "Submit follow-up",
        ),
      );
    },
  };
});

vi.mock("@/components/thread/pending-interactions/ThreadPendingInteractionBanner", () => ({
  ThreadPendingInteractionBanner: () => <div>Pending interaction</div>,
}));

vi.mock("@/components/promptbox/banner/ThreadPromptContextBanner", () => ({
  ThreadPromptContextBanner: () => null,
}));

vi.mock("@/components/promptbox/banner/QueuedMessagesList", () => ({
  QueuedMessagesList: () => null,
}));

vi.mock("@/components/promptbox/ThreadEnvironmentSummary", () => ({
  ThreadEnvironmentSummary: () => null,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  getLatestPendingInteraction: () => null,
  useThreadDefaultExecutionOptions: () => ({
    data: {
      model: "gpt-5",
      permissionMode: "workspace-write",
      providerId: "codex",
      reasoningLevel: "medium",
      serviceTier: undefined,
    },
    isError: false,
  }),
  useThreadPromptHistory: () => ({ data: [] }),
  useThreadQueuedMessages: () => ({ data: [] }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.createQueuedMessageMutateAsync,
  }),
  useDeleteThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.deleteQueuedMessageMutateAsync,
  }),
  useReorderThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.reorderQueuedMessageMutateAsync,
  }),
  useSendThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.sendQueuedMessageMutateAsync,
  }),
  useStopThread: () => ({
    isPending: false,
    mutate: mocks.stopThreadMutate,
    variables: null,
  }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    isPending: false,
    mutateAsync: mocks.uploadPromptAttachmentMutateAsync,
  }),
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: (): MockPromptDraft => mocks.promptDraft,
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    isError: false,
    isLoading: false,
    setQuery: vi.fn(),
    suggestions: [],
  }),
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    isError: false,
    isLoading: false,
    setQuery: vi.fn(),
    suggestions: [],
    trigger: "$",
  }),
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: () => ({
    activeModel: undefined,
    executionInputSources: {},
    hasMultipleProviders: false,
    modelLoadError: null,
    modelOptions: [{ label: "GPT-5", value: "gpt-5" }],
    permissionMode: "workspace-write" satisfies PermissionMode,
    permissionModeOptions: [{ label: "Workspace Write", value: "workspace-write" }],
    providerOptions: [{ label: "Codex", value: "codex" }],
    reasoningLevel: "medium" satisfies ReasoningLevel,
    reasoningOptions: [{ label: "Medium", value: "medium" }],
    selectedModel: "gpt-5",
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTier: undefined as ServiceTier | undefined,
    serviceTierSupportByProvider: { codex: false },
    setPermissionMode: vi.fn(),
    setReasoningLevel: vi.fn(),
    setSelectedModel: vi.fn(),
    setServiceTier: vi.fn(),
    supportsGoalMode: mocks.threadCreationOptions.supportsGoalMode,
    supportsPermissionModeSelection: true,
    supportsPlanMode: mocks.threadCreationOptions.supportsPlanMode,
    supportsServiceTier: false,
  }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: vi.fn(),
  },
}));

const APPS: readonly AppSummary[] = [
  {
    applicationId: "review-board",
    capabilities: ["data"],
    entry: { kind: "html", path: "index.html" },
    icon: { kind: "builtin", name: "ListTodo" },
    name: "Review Board",
    source: null,
  },
];

function makeThread(): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_1",
    id: "thr_1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Thread",
    titleFallback: "Thread",
    updatedAt: 1,
  };
}

function setupCompactViewport(): void {
  setupMatchMedia({
    matchesByQuery: new Map([[COMPACT_VIEWPORT_QUERY, true]]),
  });
}

function renderPromptArea(args: {
  apps?: readonly AppSummary[];
  onOpenApp?: (applicationId: string) => void;
} = {}) {
  render(
    <ThreadDetailPromptArea
      apps={args.apps ?? []}
      canUseGitUi={false}
      composerQueriesEnabled
      contextBannerMergeBase={null}
      childThreadsSection={null}
      isEnvironmentActionPending={false}
      onChangedFileClick={vi.fn()}
      onOpenApp={args.onOpenApp ?? vi.fn()}
      openThreadDiffPanel={vi.fn()}
      parentThreadSection={null}
      pendingInteractions={[]}
      pendingTodos={null}
      projectId="proj_1"
      resolveMentionLink={() => null}
      sendMessage={{
        isPending: false,
        mutateAsync: mocks.sendMessageMutateAsync,
      }}
      thread={makeThread()}
      workflowsSection={null}
      workspaceChangedFilesSection={null}
      workspaceStatusPending={false}
    />,
  );
}

function openDesktopMenu(): void {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Composer actions" }),
    { button: 0, ctrlKey: false },
  );
}

function openCompactMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "Composer actions" }));
}

afterEach(() => {
  cleanup();
  restoreMatchMedia();
  vi.clearAllMocks();
  mocks.promptDraft.text = "Continue the work";
  mocks.threadCreationOptions.supportsGoalMode = {
    threadStart: false,
    turnStart: false,
  };
  mocks.threadCreationOptions.supportsPlanMode = {
    threadStart: false,
    turnStart: false,
  };
});

describe("ThreadDetailPromptArea prompt actions", () => {
  it("opens apps through the thread-targeted app callback", () => {
    setupCompactViewport();
    const onOpenApp = vi.fn();
    renderPromptArea({ apps: APPS, onOpenApp });

    openCompactMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Apps" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Review Board" }));

    expect(onOpenApp).toHaveBeenCalledWith("review-board");
  });

  it("sends follow-up messages with supported Plan mode metadata", async () => {
    mocks.threadCreationOptions.supportsPlanMode = {
      threadStart: false,
      turnStart: true,
    };
    renderPromptArea();

    openDesktopMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Plan mode" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Submit follow-up" }));

    await waitFor(() => {
      expect(mocks.sendMessageMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionMode: {
          goalMode: "none",
          planMode: "plan",
        },
      }),
    );
  });
});

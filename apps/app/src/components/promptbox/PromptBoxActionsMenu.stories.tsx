import { useState, type ReactNode } from "react";
import type { AppSummary } from "@bb/server-contract";
import {
  PromptBoxActionsMenu,
  type PromptBoxActionsMenuToggleConfig,
} from "@/components/promptbox/PromptBoxActionsMenu";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "promptbox/Prompt Box Actions Menu",
};

const noop = () => {};

const BASE_APPS: readonly AppSummary[] = [
  {
    applicationId: "review-board",
    name: "Review Board",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data", "message"],
    icon: { kind: "builtin", name: "ListTodo" },
    source: null,
  },
  {
    applicationId: "release-notes",
    name: "Release Notes",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data"],
    icon: { kind: "builtin", name: "File" },
    source: { name: "team-apps", commitSha: "abc123" },
  },
  {
    applicationId: "daily-status",
    name: "Daily Status",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["message"],
    icon: { kind: "builtin", name: "GridView" },
    source: null,
  },
];

const MANY_APPS: readonly AppSummary[] = Array.from(
  { length: 18 },
  (_value, index) => {
    const appNumber = index + 1;
    return {
      applicationId: `app-${appNumber}`,
      name: `Team App ${appNumber}`,
      entry: { path: "index.html", kind: "html" },
      capabilities: ["data"],
      icon: {
        kind: "builtin",
        name: appNumber % 2 === 0 ? "GridView" : "ListTodo",
      },
      source: null,
    } satisfies AppSummary;
  },
);

interface MenuFrameProps {
  children: ReactNode;
}

function useToggle(initial: boolean): PromptBoxActionsMenuToggleConfig {
  const [checked, setChecked] = useState(initial);
  return {
    checked,
    onCheckedChange: setChecked,
  };
}

function MenuFrame({ children }: MenuFrameProps) {
  return <div className="flex min-h-24 items-center px-3">{children}</div>;
}

function CodexMenuRow() {
  const planMode = useToggle(false);
  const goalMode = useToggle(false);
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "$", onSelect: noop }}
        planMode={planMode}
        goalMode={goalMode}
        apps={{ apps: BASE_APPS, onSelect: noop }}
      />
    </MenuFrame>
  );
}

function ClaudeMenuRow() {
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "/", onSelect: noop }}
        apps={{ apps: BASE_APPS, onSelect: noop }}
      />
    </MenuFrame>
  );
}

function UnsupportedProviderRow() {
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        apps={{ apps: [], onSelect: noop }}
      />
    </MenuFrame>
  );
}

function ActivePlanRow() {
  const planMode = useToggle(true);
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "$", onSelect: noop }}
        planMode={planMode}
      />
    </MenuFrame>
  );
}

function ActiveGoalRow() {
  const goalMode = useToggle(true);
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "$", onSelect: noop }}
        goalMode={goalMode}
      />
    </MenuFrame>
  );
}

function BothModesRow() {
  const planMode = useToggle(true);
  const goalMode = useToggle(true);
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "$", onSelect: noop }}
        planMode={planMode}
        goalMode={goalMode}
        apps={{ apps: BASE_APPS, onSelect: noop }}
      />
    </MenuFrame>
  );
}

function ManyAppsRow() {
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "$", onSelect: noop }}
        apps={{ apps: MANY_APPS, onSelect: noop }}
      />
    </MenuFrame>
  );
}

function CachedAppsFailureRow() {
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
        createApp={{ onSelect: noop }}
        skills={{ shortcut: "$", onSelect: noop }}
        apps={{ apps: BASE_APPS, onSelect: noop }}
      />
    </MenuFrame>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="codex" hint="Skills shows $, Plan and Goal available">
        <CodexMenuRow />
      </StoryRow>
      <StoryRow label="claude code" hint="Skills shows /, modes hidden">
        <ClaudeMenuRow />
      </StoryRow>
      <StoryRow
        label="unsupported provider"
        hint="Skills and Apps hidden when unavailable"
      >
        <UnsupportedProviderRow />
      </StoryRow>
      <StoryRow label="plan active" hint="trigger reflects active mode">
        <ActivePlanRow />
      </StoryRow>
      <StoryRow label="goal active" hint="trigger reflects active mode">
        <ActiveGoalRow />
      </StoryRow>
      <StoryRow label="both active" hint="independent sticky modes">
        <BothModesRow />
      </StoryRow>
      <StoryRow
        label="many apps"
        hint="Apps submenu scrolls when the installed app list is long"
      >
        <ManyAppsRow />
      </StoryRow>
      <StoryRow
        label="cached apps after load failure"
        hint="cached app data still renders when callers keep data"
      >
        <CachedAppsFailureRow />
      </StoryRow>
    </StoryCard>
  );
}

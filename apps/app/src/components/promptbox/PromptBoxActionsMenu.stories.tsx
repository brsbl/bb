import { useState, type ReactNode } from "react";
import {
  PromptBoxActionsMenu,
  type PromptBoxActionsMenuToggleConfig,
} from "@/components/promptbox/PromptBoxActionsMenu";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "promptbox/Prompt Box Actions Menu",
};

const noop = () => {};

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
        skills={{ shortcut: "$", onSelect: noop }}
        planMode={planMode}
        goalMode={goalMode}
      />
    </MenuFrame>
  );
}

function ClaudeMenuRow() {
  return (
    <MenuFrame>
      <PromptBoxActionsMenu skills={{ shortcut: "/", onSelect: noop }} />
    </MenuFrame>
  );
}

function UnsupportedProviderRow() {
  return (
    <MenuFrame>
      <PromptBoxActionsMenu />
    </MenuFrame>
  );
}

function ActivePlanRow() {
  const planMode = useToggle(true);
  return (
    <MenuFrame>
      <PromptBoxActionsMenu
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
        skills={{ shortcut: "$", onSelect: noop }}
        planMode={planMode}
        goalMode={goalMode}
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
        hint="Skills hidden when unavailable"
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
    </StoryCard>
  );
}

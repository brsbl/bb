import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ProviderCommandTrigger } from "./mentions/command-trigger";

type PromptBoxMenuSelectEvent = Event;

export interface PromptBoxActionsMenuSkillsConfig {
  shortcut: ProviderCommandTrigger;
  onSelect: () => void;
}

export interface PromptBoxActionsMenuToggleConfig {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface PromptBoxActionsMenuProps {
  className?: string;
  goalMode?: PromptBoxActionsMenuToggleConfig;
  planMode?: PromptBoxActionsMenuToggleConfig;
  skills?: PromptBoxActionsMenuSkillsConfig;
}

interface PromptBoxActionsMenuTopLevelProps {
  goalMode: PromptBoxActionsMenuToggleConfig | undefined;
  onClose: () => void;
  planMode: PromptBoxActionsMenuToggleConfig | undefined;
  skills: PromptBoxActionsMenuSkillsConfig | undefined;
}

interface PromptBoxMenuActionRowProps {
  disabled?: boolean;
  iconName: "CircleCheck" | "ListTodo" | "Zap";
  label: string;
  onSelect: () => void;
  shortcut?: string;
}

interface PromptBoxMenuToggleRowProps {
  config: PromptBoxActionsMenuToggleConfig;
  iconName: "CircleCheck" | "ListTodo";
  label: string;
}

const MENU_CONTENT_CLASS =
  "max-h-[min(360px,calc(100vh-24px))] w-64 overflow-y-auto";
const MENU_ACTION_LABEL_CLASS = "min-w-0 shrink-0";
const MENU_SWITCH_TRACK_CLASS =
  "ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted shadow-xs transition-colors data-[state=checked]:bg-foreground";
const MENU_SWITCH_THUMB_CLASS =
  "block size-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0";

export function PromptBoxActionsMenu({
  className,
  goalMode,
  planMode,
  skills,
}: PromptBoxActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const active = Boolean(planMode?.checked || goalMode?.checked);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title="Composer actions"
          aria-label="Composer actions"
          aria-pressed={active}
          className={cn(
            COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
            active && "bg-state-active text-foreground",
            className,
          )}
        >
          <Icon name="Plus" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        collisionPadding={12}
        mobileTitle="Composer actions"
        className={MENU_CONTENT_CLASS}
      >
        <PromptBoxActionsMenuTopLevel
          goalMode={goalMode}
          onClose={closeMenu}
          planMode={planMode}
          skills={skills}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PromptBoxActionsMenuTopLevel({
  goalMode,
  onClose,
  planMode,
  skills,
}: PromptBoxActionsMenuTopLevelProps) {
  const handleSkillsSelect = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => {
      skills?.onSelect();
    });
  }, [onClose, skills]);

  const hasModeToggles = planMode !== undefined || goalMode !== undefined;

  return (
    <>
      {skills ? (
        <PromptBoxMenuActionRow
          iconName="Zap"
          label="Skills"
          onSelect={handleSkillsSelect}
          shortcut={skills.shortcut}
        />
      ) : null}
      {hasModeToggles && skills ? <DropdownMenuSeparator /> : null}
      {planMode ? (
        <PromptBoxMenuToggleRow
          config={planMode}
          iconName="ListTodo"
          label="Plan mode"
        />
      ) : null}
      {goalMode ? (
        <PromptBoxMenuToggleRow
          config={goalMode}
          iconName="CircleCheck"
          label="Goal mode"
        />
      ) : null}
    </>
  );
}

function PromptBoxMenuActionRow({
  disabled,
  iconName,
  label,
  onSelect,
  shortcut,
}: PromptBoxMenuActionRowProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onSelect();
      }}
    >
      <Icon
        name={iconName}
        className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
      />
      <span className={MENU_ACTION_LABEL_CLASS}>{label}</span>
      {shortcut ? (
        <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}

function PromptBoxMenuToggleRow({
  config,
  iconName,
  label,
}: PromptBoxMenuToggleRowProps) {
  const handleSelect = useCallback(
    (event: PromptBoxMenuSelectEvent) => {
      event.preventDefault();
      if (config.disabled) {
        return;
      }
      config.onCheckedChange(!config.checked);
    },
    [config],
  );

  return (
    <DropdownMenuItem
      disabled={config.disabled}
      aria-checked={config.checked}
      role="menuitemcheckbox"
      onSelect={handleSelect}
    >
      <Icon
        name={iconName}
        className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
      />
      <span className={MENU_ACTION_LABEL_CLASS}>{label}</span>
      <span
        aria-hidden="true"
        data-state={config.checked ? "checked" : "unchecked"}
        className={MENU_SWITCH_TRACK_CLASS}
      >
        <span
          data-state={config.checked ? "checked" : "unchecked"}
          className={MENU_SWITCH_THUMB_CLASS}
        />
      </span>
    </DropdownMenuItem>
  );
}

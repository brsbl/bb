import { useCallback, useState } from "react";
import type { AppSummary } from "@bb/server-contract";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { Button } from "@/components/ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ProviderCommandTrigger } from "./mentions/command-trigger";

type PromptBoxActionsPanel = "top-level" | "apps";

type PromptBoxMenuSelectEvent = Event;

export interface PromptBoxActionsMenuCreateAppConfig {
  disabled?: boolean;
  onSelect: () => void;
}

export interface PromptBoxActionsMenuSkillsConfig {
  shortcut: ProviderCommandTrigger;
  onSelect: () => void;
}

export interface PromptBoxActionsMenuToggleConfig {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface PromptBoxActionsMenuAppsConfig {
  apps: readonly AppSummary[];
  onSelect: (applicationId: string) => void;
}

export interface PromptBoxActionsMenuProps {
  apps?: PromptBoxActionsMenuAppsConfig;
  className?: string;
  createApp: PromptBoxActionsMenuCreateAppConfig;
  goalMode?: PromptBoxActionsMenuToggleConfig;
  planMode?: PromptBoxActionsMenuToggleConfig;
  skills?: PromptBoxActionsMenuSkillsConfig;
}

interface PromptBoxActionsMenuTopLevelProps {
  apps: PromptBoxActionsMenuAppsConfig | undefined;
  createApp: PromptBoxActionsMenuCreateAppConfig;
  goalMode: PromptBoxActionsMenuToggleConfig | undefined;
  isCompactViewport: boolean;
  onAppSelect: (applicationId: string) => void;
  onClose: () => void;
  onOpenAppsPanel: () => void;
  planMode: PromptBoxActionsMenuToggleConfig | undefined;
  skills: PromptBoxActionsMenuSkillsConfig | undefined;
}

interface PromptBoxActionsMenuAppsPanelProps {
  apps: PromptBoxActionsMenuAppsConfig;
  onAppSelect: (applicationId: string) => void;
  onBack: () => void;
}

interface PromptBoxMenuActionRowProps {
  disabled?: boolean;
  iconName:
    | "ChevronLeft"
    | "CircleCheck"
    | "GridView"
    | "ListTodo"
    | "Plus"
    | "Zap";
  label: string;
  keepOpenOnSelect?: boolean;
  onSelect: () => void;
  shortcut?: string;
  trailingIconName?: "ChevronRight";
}

interface PromptBoxMenuToggleRowProps {
  config: PromptBoxActionsMenuToggleConfig;
  iconName: "CircleCheck" | "ListTodo";
  label: string;
}

interface PromptBoxAppsListProps {
  apps: readonly AppSummary[];
  onAppSelect: (applicationId: string) => void;
}

const MENU_CONTENT_CLASS =
  "max-h-[min(360px,calc(100vh-24px))] w-64 overflow-y-auto";
const APPS_SUBMENU_CONTENT_CLASS =
  "max-h-[min(420px,calc(100vh-24px))] w-64 overflow-y-auto";
const MENU_ACTION_LABEL_CLASS = "min-w-0 shrink-0";
const MENU_APP_LABEL_CLASS = "min-w-0 flex-1 truncate";
const MENU_SWITCH_TRACK_CLASS =
  "ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted shadow-xs transition-colors data-[state=checked]:bg-foreground";
const MENU_SWITCH_THUMB_CLASS =
  "block size-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0";

export function PromptBoxActionsMenu({
  apps,
  className,
  createApp,
  goalMode,
  planMode,
  skills,
}: PromptBoxActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PromptBoxActionsPanel>("top-level");
  const isCompactViewport = useIsCompactViewport();
  const hasApps = Boolean(apps && apps.apps.length > 0);
  const active = Boolean(planMode?.checked || goalMode?.checked);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setPanel("top-level");
    }
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setPanel("top-level");
  }, []);

  const openAppsPanel = useCallback(() => {
    setPanel("apps");
  }, []);

  const backToTopLevel = useCallback(() => {
    setPanel("top-level");
  }, []);

  const handleAppSelect = useCallback(
    (applicationId: string) => {
      apps?.onSelect(applicationId);
      closeMenu();
    },
    [apps, closeMenu],
  );

  const panelContent =
    isCompactViewport && panel === "apps" && hasApps && apps ? (
      <PromptBoxActionsMenuAppsPanel
        apps={apps}
        onAppSelect={handleAppSelect}
        onBack={backToTopLevel}
      />
    ) : (
      <PromptBoxActionsMenuTopLevel
        apps={hasApps ? apps : undefined}
        createApp={createApp}
        goalMode={goalMode}
        isCompactViewport={isCompactViewport}
        onAppSelect={handleAppSelect}
        onClose={closeMenu}
        onOpenAppsPanel={openAppsPanel}
        planMode={planMode}
        skills={skills}
      />
    );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
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
        mobileTitle={panel === "apps" ? "Apps" : "Composer actions"}
        className={MENU_CONTENT_CLASS}
      >
        {panelContent}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PromptBoxActionsMenuTopLevel({
  apps,
  createApp,
  goalMode,
  isCompactViewport,
  onAppSelect,
  onClose,
  onOpenAppsPanel,
  planMode,
  skills,
}: PromptBoxActionsMenuTopLevelProps) {
  const handleCreateAppSelect = useCallback(() => {
    createApp.onSelect();
    onClose();
  }, [createApp, onClose]);

  const handleSkillsSelect = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => {
      skills?.onSelect();
    });
  }, [onClose, skills]);

  const hasModeToggles = planMode !== undefined || goalMode !== undefined;
  const hasApps = apps !== undefined && apps.apps.length > 0;

  return (
    <>
      <PromptBoxMenuActionRow
        disabled={createApp.disabled}
        iconName="Plus"
        label="Create App..."
        onSelect={handleCreateAppSelect}
      />
      {skills ? (
        <PromptBoxMenuActionRow
          iconName="Zap"
          label="Skills"
          onSelect={handleSkillsSelect}
          shortcut={skills.shortcut}
        />
      ) : null}
      {hasModeToggles ? <DropdownMenuSeparator /> : null}
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
      {hasApps ? <DropdownMenuSeparator /> : null}
      {hasApps && apps ? (
        isCompactViewport ? (
          <PromptBoxMenuActionRow
            iconName="GridView"
            keepOpenOnSelect
            label="Apps"
            onSelect={onOpenAppsPanel}
            trailingIconName="ChevronRight"
          />
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon
                name="GridView"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
              />
              <span className={MENU_ACTION_LABEL_CLASS}>Apps</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              collisionPadding={12}
              sideOffset={8}
              className={APPS_SUBMENU_CONTENT_CLASS}
            >
              <PromptBoxAppsList apps={apps.apps} onAppSelect={onAppSelect} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      ) : null}
    </>
  );
}

function PromptBoxActionsMenuAppsPanel({
  apps,
  onAppSelect,
  onBack,
}: PromptBoxActionsMenuAppsPanelProps) {
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        <Icon
          name="ChevronLeft"
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
        />
        <span className={MENU_ACTION_LABEL_CLASS}>Back</span>
      </DropdownMenuItem>
      <PromptBoxAppsList apps={apps.apps} onAppSelect={onAppSelect} />
    </>
  );
}

function PromptBoxMenuActionRow({
  disabled,
  iconName,
  keepOpenOnSelect,
  label,
  onSelect,
  shortcut,
  trailingIconName,
}: PromptBoxMenuActionRowProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (keepOpenOnSelect) {
          event.preventDefault();
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
      {trailingIconName ? (
        <Icon
          name={trailingIconName}
          className={cn("ml-auto", COARSE_POINTER_COMPACT_ICON_SIZE_CLASS)}
        />
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

function PromptBoxAppsList({ apps, onAppSelect }: PromptBoxAppsListProps) {
  return (
    <>
      <DropdownMenuLabel>{apps.length} installed apps</DropdownMenuLabel>
      {apps.map((app) => (
        <DropdownMenuItem
          key={app.applicationId}
          onSelect={() => onAppSelect(app.applicationId)}
        >
          <ResolvedAppIcon
            icon={app.icon}
            className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          />
          <span className={MENU_APP_LABEL_CLASS}>{app.name}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

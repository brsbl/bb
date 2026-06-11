// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AppSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreMatchMedia, setupMatchMedia } from "@/test/helpers/match-media";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import {
  PromptBoxActionsMenu,
  type PromptBoxActionsMenuProps,
} from "./PromptBoxActionsMenu";

const APPS: readonly AppSummary[] = [
  {
    applicationId: "review-board",
    name: "Review Board",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data", "message"],
    icon: { kind: "builtin", name: "ListTodo" },
    source: null,
  },
  {
    applicationId: "status",
    name: "Status",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data"],
    icon: { kind: "builtin", name: "GridView" },
    source: null,
  },
];

interface RenderMenuArgs {
  props?: Partial<PromptBoxActionsMenuProps>;
}

function setupCompactViewport(): void {
  setupMatchMedia({
    matchesByQuery: new Map([[COMPACT_VIEWPORT_QUERY, true]]),
  });
}

function renderMenu({ props = {} }: RenderMenuArgs = {}) {
  const createApp = props.createApp ?? { onSelect: vi.fn() };
  return render(<PromptBoxActionsMenu createApp={createApp} {...props} />);
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
});

describe("PromptBoxActionsMenu", () => {
  it("renders top-level actions in the specified order without attachment rows", () => {
    renderMenu({
      props: {
        skills: { shortcut: "$", onSelect: vi.fn() },
        planMode: { checked: false, onCheckedChange: vi.fn() },
        goalMode: { checked: false, onCheckedChange: vi.fn() },
        apps: { apps: APPS, onSelect: vi.fn() },
      },
    });

    openDesktopMenu();

    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Create App...", "Skills$", "Apps"]);
    expect(
      within(menu)
        .getAllByRole("menuitemcheckbox")
        .map((item) => item.textContent),
    ).toEqual(["Plan mode", "Goal mode"]);
    expect(within(menu).queryByText("Add photos & files")).toBeNull();
    expect(within(menu).queryByText("Attach files")).toBeNull();
  });

  it("shows the provider skill shortcut and closes after selection", async () => {
    const onSelect = vi.fn();
    renderMenu({
      props: {
        skills: { shortcut: "/", onSelect },
      },
    });

    openDesktopMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Skills/" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hides Skills and Apps when no provider trigger or installed apps exist", () => {
    renderMenu({
      props: {
        apps: { apps: [], onSelect: vi.fn() },
      },
    });

    openDesktopMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Skills/u })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /Apps/u })).toBeNull();
  });

  it("toggles Plan and Goal without closing the menu", () => {
    const onPlanChange = vi.fn();
    const onGoalChange = vi.fn();
    renderMenu({
      props: {
        planMode: { checked: false, onCheckedChange: onPlanChange },
        goalMode: { checked: true, onCheckedChange: onGoalChange },
      },
    });

    openDesktopMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Plan mode" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Goal mode" }));

    expect(onPlanChange).toHaveBeenCalledWith(true);
    expect(onGoalChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("marks the trigger pressed when a mode is active", () => {
    renderMenu({
      props: {
        planMode: { checked: true, onCheckedChange: vi.fn() },
      },
    });

    expect(
      screen
        .getByRole("button", { name: "Composer actions" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("drills into Apps and returns on compact viewports", () => {
    setupCompactViewport();
    const onAppSelect = vi.fn();
    renderMenu({
      props: {
        apps: { apps: APPS, onSelect: onAppSelect },
      },
    });

    openCompactMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Apps/u }));

    expect(screen.getByText("2 installed apps")).toBeTruthy();
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Back", "Review Board", "Status"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    expect(screen.getByRole("menuitem", { name: "Create App..." })).toBeTruthy();
    expect(screen.queryByText("2 installed apps")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: /Apps/u }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Review Board" }));

    expect(onAppSelect).toHaveBeenCalledWith("review-board");
  });

  it("preserves toggle checkbox semantics on compact viewports", () => {
    setupCompactViewport();
    renderMenu({
      props: {
        planMode: { checked: true, onCheckedChange: vi.fn() },
        goalMode: { checked: false, onCheckedChange: vi.fn() },
      },
    });

    openCompactMenu();

    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Plan mode" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Goal mode" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});

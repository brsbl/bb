// @vitest-environment jsdom

import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneContent } from "@/lib/split-layout";
import SplitWorkspaceRoute from "./SplitWorkspaceRoute";

const workspaceLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("./thread-detail/SplitThreadArea", () => ({
  SplitThreadArea: ({ routeContent }: { routeContent: PaneContent }) => {
    useEffect(() => {
      workspaceLifecycle.mounts += 1;
      return () => {
        workspaceLifecycle.unmounts += 1;
      };
    }, []);
    return <output data-testid="route-content">{routeContent.kind}</output>;
  },
}));

vi.mock("./RootComposeView", () => ({
  LegacyProjectComposeRedirect: () => <div>legacy redirect</div>,
}));

vi.mock("./EnvironmentServiceRoute", () => ({
  EnvironmentServiceRoute: () => <div>environment service</div>,
}));

function NavigationControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/")}>compose</button>
      <button onClick={() => navigate("/plugins/docs/docs/work/today.md")}>
        plugin
      </button>
      <button onClick={() => navigate("/threads/thread-1")}>thread</button>
    </>
  );
}

describe("SplitWorkspaceRoute", () => {
  beforeEach(() => {
    workspaceLifecycle.mounts = 0;
    workspaceLifecycle.unmounts = 0;
  });

  it("preserves the workspace mount across focus-driven page URL changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <NavigationControls />
        <Routes>
          <Route path="*" element={<SplitWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("route-content").textContent).toBe("new-thread");

    fireEvent.click(screen.getByRole("button", { name: "plugin" }));
    expect(screen.getByTestId("route-content").textContent).toBe(
      "plugin-panel",
    );

    fireEvent.click(screen.getByRole("button", { name: "thread" }));
    expect(screen.getByTestId("route-content").textContent).toBe("thread");
    expect(workspaceLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("owns durable environment service links through the lazy workspace route", () => {
    const { container } = render(
      <MemoryRouter
        initialEntries={["/services/host_air/4173?path=%2Fpreview"]}
      >
        <Routes>
          <Route path="*" element={<SplitWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(within(container).getByText("environment service")).not.toBeNull();
    expect(within(container).queryByTestId("route-content")).toBeNull();
  });
});

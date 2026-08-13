// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

describe("GitHub Activity panel", () => {
  it("renders each item with compact resource context and a plain-language update", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const panel = app.navPanels[0]!;
    const slot = renderSlot(
      panel,
      { subPath: "" },
      {
        experimental_openRightPanel: () => true,
        rpc: {
          listNotifications: () => ({
            fetchedAt: "2026-08-12T12:00:00Z",
            login: "brsbl",
            items: [
              {
                id: "n1",
                activity: "Approved",
                activityKind: "approved",
                actor: "alice",
                number: 42,
                repo: "get-bb/bb",
                resourceKind: "pr",
                title: "Scannable activity",
                unread: true,
                updatedAt: "2026-08-12T12:00:00Z",
                url: "https://github.com/get-bb/bb/pull/42",
              },
              {
                id: "n2",
                activity: "New comment",
                activityKind: "comment",
                actor: null,
                number: 7,
                repo: "brsbl/moss",
                resourceKind: "issue",
                title: "Keep links local",
                unread: false,
                updatedAt: "2026-08-11T12:00:00Z",
                url: "https://github.com/brsbl/moss/issues/7",
              },
              {
                id: "n3",
                activity: "New review",
                activityKind: "review",
                actor: "carol",
                number: 43,
                repo: "get-bb/bb",
                resourceKind: "pr",
                title: "Review without a duplicate label",
                unread: false,
                updatedAt: "2026-08-10T12:00:00Z",
                url: "https://github.com/get-bb/bb/pull/43",
              },
              {
                id: "n4",
                activity: "Mention",
                activityKind: "mention",
                actor: "dana",
                number: 8,
                repo: "brsbl/moss",
                resourceKind: "issue",
                title: "Mention without a duplicate label",
                unread: false,
                updatedAt: "2026-08-09T12:00:00Z",
                url: "https://github.com/brsbl/moss/issues/8",
              },
            ],
          }),
        },
      },
    );
    expect(await slot.findByText("PR #42")).toBeDefined();
    expect(screen.getByText("approved")).toBeDefined();
    const actor = screen.getByText("@alice").parentElement!;
    expect(actor.className).toContain("rounded-full");
    expect(actor.className).toContain("bg-muted/40");
    expect(actor.className).toContain("font-normal");
    expect(actor.className).toContain("text-muted-foreground");
    const avatarImage = actor.querySelector(
      'img[src="https://github.com/alice.png?size=32"]',
    );
    expect(avatarImage).not.toBeNull();
    fireEvent.error(avatarImage!);
    expect(actor.querySelector("img")).toBeNull();
    expect(actor.querySelector("svg")).not.toBeNull();
    const approvedStatus = screen.getByLabelText("Approved");
    expect(approvedStatus.querySelector("svg")).not.toBeNull();
    expect(approvedStatus.textContent).not.toContain("Approved");
    expect(approvedStatus.className).toContain("text-success");
    expect(approvedStatus.className).not.toContain("rounded");
    expect(approvedStatus.className).not.toContain("bg-success");
    fireEvent.focus(approvedStatus);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Approved");
    const fallbackActor = screen.getByText("Someone").parentElement!;
    expect(fallbackActor.querySelector("img")).toBeNull();
    expect(fallbackActor.querySelector("svg")).not.toBeNull();
    const reviewStatus = screen.getByLabelText("Review");
    expect(reviewStatus.textContent).toBe("");
    expect(reviewStatus.className).toContain("text-foreground");
    expect(reviewStatus.className).not.toContain("rounded");
    expect(reviewStatus.querySelector("svg")?.dataset.icon).toBe(
      "ChatFeedback",
    );
    const mentionStatus = screen.getByLabelText("Mention");
    expect(mentionStatus.textContent).toBe("");
    expect(mentionStatus.className).toContain("text-foreground");
    expect(mentionStatus.className).not.toContain("text-warning");
    expect(mentionStatus.className).not.toContain("rounded");
    expect(mentionStatus.querySelector("svg")?.dataset.icon).toBe(
      "MailAtSign",
    );
    fireEvent.blur(approvedStatus);
    fireEvent.focus(mentionStatus);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toBe("Mention");
    });
    const updatedTime = screen.getAllByLabelText(/^Updated /u)[0]!;
    expect(updatedTime.getAttribute("title")).toMatch(/^Updated /u);
    expect(updatedTime.querySelector("svg")).not.toBeNull();
    expect(updatedTime.className).not.toContain("rounded");
    expect(updatedTime.className).not.toContain("bg-muted");
    expect(screen.getAllByText("get-bb/bb")).toHaveLength(2);
    expect(screen.getByText("Scannable activity")).toBeDefined();
    const link = screen.getByRole("link", {
      name: /Pull request get-bb\/bb number 42/u,
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/get-bb/bb/pull/42",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.querySelector("svg")?.dataset.icon).toBe("GitPullRequest");
    expect(
      link
        .querySelector("svg")
        ?.classList.contains("text-muted-foreground"),
    ).toBe(
      true,
    );
    expect(link.querySelector("svg")?.classList.contains("text-success")).toBe(
      false,
    );
    const issueLink = screen.getByRole("link", {
      name: /Issue brsbl\/moss number 7/u,
    });
    expect(issueLink.querySelector("svg")?.dataset.icon).toBe("CircleDot");
    expect(
      issueLink
        .querySelector("svg")
        ?.classList.contains("text-muted-foreground"),
    ).toBe(true);
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "experimental_openRightPanel",
      request: {
        kind: "browser",
        url: "https://github.com/get-bb/bb/pull/42",
      },
    });
    expect(screen.getByRole("columnheader", { name: /Item/u })).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: /Latest update/u }),
    ).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: /Updated/u }),
    ).toBeDefined();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter by resource type" }),
      {
        target: { value: "issue" },
      },
    );
    expect(screen.queryByText("Scannable activity")).toBeNull();
    expect(screen.getByText("Keep links local")).toBeDefined();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter GitHub activity" }),
      {
        target: { value: "not present" },
      },
    );
    expect(screen.getByText("No matching activity")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Scannable activity")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Sort by Item/u }));
    const links = screen.getAllByRole("link");
    expect(links[0]?.textContent).toContain("Keep links local");

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh GitHub activity" }),
    );
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.at(-1)).toEqual({
        method: "listNotifications",
        input: { force: true },
      });
    });
    slot.lifecycle.unmount();
  });
});

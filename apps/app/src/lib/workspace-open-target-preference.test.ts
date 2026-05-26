import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { resolvePreferredWorkspaceOpenTarget } from "./workspace-open-target-preference";

const TARGETS: WorkspaceOpenTarget[] = [
  {
    id: "finder",
    kind: "file-browser",
    label: "Finder",
  },
  {
    id: "vscode",
    kind: "editor",
    label: "VS Code",
  },
];

describe("resolvePreferredWorkspaceOpenTarget", () => {
  it("chooses a stored target, then an editor, then the first available target", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId: "finder",
        targets: TARGETS,
      }),
    ).toEqual({
      id: "finder",
      kind: "file-browser",
      label: "Finder",
    });
    expect(
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId: null,
        targets: TARGETS,
      }),
    ).toEqual({
      id: "vscode",
      kind: "editor",
      label: "VS Code",
    });
    expect(
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId: null,
        targets: [
          {
            id: "default-app",
            kind: "editor",
            label: "Default App",
          },
          {
            id: "finder",
            kind: "file-browser",
            label: "Finder",
          },
        ],
      }),
    ).toEqual({
      id: "default-app",
      kind: "editor",
      label: "Default App",
    });
    expect(
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId: null,
        targets: [
          {
            id: "finder",
            kind: "file-browser",
            label: "Finder",
          },
          {
            id: "terminal",
            kind: "terminal",
            label: "Terminal",
          },
        ],
      }),
    ).toEqual({
      id: "finder",
      kind: "file-browser",
      label: "Finder",
    });
  });

  it("returns null when there are no available targets", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId: "vscode",
        targets: [],
      }),
    ).toBeNull();
  });
});

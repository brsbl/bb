import { listThreads } from "@bb/db";
import { describe, expect, it } from "vitest";
import { DEFAULT_SUBMISSION_MODE } from "@bb/domain";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import {
  ensureProviderSupportsSubmissionMode,
  resolveSubmissionMode,
} from "../../../src/services/threads/thread-submission-mode.js";
import { seedHostSession, seedProjectWithSource } from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("thread submission mode policy", () => {
  it("fills default submission mode when the client omits it", () => {
    expect(resolveSubmissionMode({})).toEqual(DEFAULT_SUBMISSION_MODE);
  });

  it("allows Codex turn-start Plan and Goal modes", () => {
    expect(() =>
      ensureProviderSupportsSubmissionMode({
        entrypoint: "turnStart",
        providerId: "codex",
        submissionMode: { planMode: "plan", goalMode: "goal" },
      }),
    ).not.toThrow();
  });

  it("rejects submission modes for unsupported provider entrypoints", () => {
    expect(() =>
      ensureProviderSupportsSubmissionMode({
        entrypoint: "threadStart",
        providerId: "codex",
        submissionMode: { planMode: "plan", goalMode: "none" },
      }),
    ).toThrow('Provider "codex" does not support Plan mode for threadStart.');

    expect(() =>
      ensureProviderSupportsSubmissionMode({
        entrypoint: "turnStart",
        providerId: "claude-code",
        submissionMode: { planMode: "default", goalMode: "goal" },
      }),
    ).toThrow(
      'Provider "claude-code" does not support Goal mode for turnStart.',
    );
  });

  it("rejects unsupported create-thread modes before creating a thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-start-submission-mode",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      await expect(
        createThreadFromRequest(harness.deps, {
          automationId: null,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: null },
          },
          input: textInput("Start in plan mode"),
          origin: null,
          projectId: project.id,
          providerId: "codex",
          submissionMode: { planMode: "plan", goalMode: "none" },
        }),
      ).rejects.toMatchObject({
        body: {
          code: "unsupported_submission_mode",
          message:
            'Provider "codex" does not support Plan mode for threadStart.',
        },
      });

      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );
    });
  });
});

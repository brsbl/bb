import {
  listProviderTurnIdleWatchdogCandidates,
  listProviderTurnIdleWatchdogOpenItems,
} from "@bb/db";
import type { ProviderTurnIdleWatchdogCandidateRow } from "@bb/db";
import type {
  ProviderTurnWatchdogOpenItem,
  SystemProviderTurnWatchdogEventData,
} from "@bb/domain";
import { threadScope } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { appendThreadEvent } from "./thread-events.js";
import { requestThreadStop } from "./thread-lifecycle.js";

export const PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS = 15 * 60_000;
export const PROVIDER_TURN_IDLE_WATCHDOG_BATCH_SIZE = 25;
export const PROVIDER_TURN_IDLE_WATCHDOG_OPEN_ITEM_LIMIT = 5;

export type ProviderTurnWatchdogSweepDeps = Pick<
  AppDeps,
  "db" | "hub" | "logger"
>;

export interface RunProviderTurnWatchdogSweepOptions {
  idleThresholdMs?: number;
  limit?: number;
  now?: number;
}

export interface RunProviderTurnWatchdogSweepResult {
  interruptedThreadIds: string[];
}

interface BuildProviderTurnWatchdogEventDataArgs {
  idleThresholdMs: number;
  now: number;
  openItems: ProviderTurnWatchdogOpenItem[];
}

function buildProviderTurnWatchdogEventData(
  candidate: ProviderTurnIdleWatchdogCandidateRow,
  args: BuildProviderTurnWatchdogEventDataArgs,
): SystemProviderTurnWatchdogEventData {
  return {
    reason: "provider-turn-idle",
    thresholdMs: args.idleThresholdMs,
    elapsedMs: candidate.elapsedMs,
    activeTurnId: candidate.activeTurnId,
    activeTurnStartedAt: candidate.activeTurnStartedAt,
    lastActivityEventSequence: candidate.lastActivityEventSequence,
    lastActivityEventType: candidate.lastActivityEventType,
    lastActivityEventAt: candidate.lastActivityEventAt,
    providerId: candidate.providerId,
    providerThreadId: candidate.providerThreadId,
    firedAt: args.now,
    openItems: args.openItems,
  };
}

export function runProviderTurnWatchdogSweep(
  deps: ProviderTurnWatchdogSweepDeps,
  options: RunProviderTurnWatchdogSweepOptions = {},
): RunProviderTurnWatchdogSweepResult {
  const now = options.now ?? Date.now();
  const idleThresholdMs =
    options.idleThresholdMs ?? PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS;
  const candidates = listProviderTurnIdleWatchdogCandidates(deps.db, {
    idleThresholdMs,
    limit: options.limit ?? PROVIDER_TURN_IDLE_WATCHDOG_BATCH_SIZE,
    now,
  });
  const interruptedThreadIds: string[] = [];

  for (const candidate of candidates) {
    const openItems = listProviderTurnIdleWatchdogOpenItems(deps.db, {
      limit: PROVIDER_TURN_IDLE_WATCHDOG_OPEN_ITEM_LIMIT,
      threadId: candidate.threadId,
      turnId: candidate.activeTurnId,
    });
    const data = buildProviderTurnWatchdogEventData(candidate, {
      idleThresholdMs,
      now,
      openItems,
    });

    try {
      appendThreadEvent(deps, {
        threadId: candidate.threadId,
        environmentId: candidate.environmentId,
        type: "system/provider-turn-watchdog",
        scope: threadScope(),
        data,
      });
      requestThreadStop(deps, {
        environmentId: candidate.environmentId,
        hostId: candidate.hostId,
        interruptionReason: "provider-turn-idle",
        stopRequestedAt: null,
        threadId: candidate.threadId,
      });
      interruptedThreadIds.push(candidate.threadId);
      deps.logger.warn(
        {
          activeTurnId: candidate.activeTurnId,
          elapsedMs: candidate.elapsedMs,
          idleThresholdMs,
          lastActivityEventSequence: candidate.lastActivityEventSequence,
          lastActivityEventType: candidate.lastActivityEventType,
          openItemCount: openItems.length,
          primaryOpenItemCommand: openItems[0]?.command ?? null,
          primaryOpenItemKind: openItems[0]?.itemKind ?? null,
          providerId: candidate.providerId,
          providerThreadId: candidate.providerThreadId,
          threadId: candidate.threadId,
        },
        "Provider turn watchdog requested thread stop after idle provider turn",
      );
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: candidate.threadId,
        },
        "Provider turn watchdog failed to request thread stop",
      );
    }
  }

  return { interruptedThreadIds };
}

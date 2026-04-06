"use client";

import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity";

import type { IslandApproval } from "./island-store";

import type { Message } from "@/lib/chat/message-types";

export const ISLAND_STATUS_STEPS = [
  "listen",
  "remember",
  "evolve",
  "render",
] as const;

export type IslandStatusStep = (typeof ISLAND_STATUS_STEPS)[number];

export type IslandRuntimeStatus = {
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  stageHistory: IslandStatusStep[];
};

type IslandChatSnapshotLike = {
  messages: Message[];
  isLoading: boolean;
  globalLoading: boolean;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  errorMessage: string | null;
};

function toKnownStage(
  stage: string | null | undefined,
): IslandStatusStep | null {
  if (!stage) return null;
  return ISLAND_STATUS_STEPS.includes(stage as IslandStatusStep)
    ? (stage as IslandStatusStep)
    : null;
}

function buildApprovalStatusMeta(pendingApproval: IslandApproval | null) {
  if (!pendingApproval) return null;
  return {
    tool_name: pendingApproval.toolName,
    ...(pendingApproval.callId ? { call_id: pendingApproval.callId } : {}),
  };
}

export function appendIslandStageHistory(
  history: IslandStatusStep[],
  stage: string | null | undefined,
): IslandStatusStep[] {
  const nextStage = toKnownStage(stage);
  if (!nextStage) return history;
  if (history[history.length - 1] === nextStage) return history;
  const withoutDuplicate = history.filter((entry) => entry !== nextStage);
  return [...withoutDuplicate, nextStage].slice(-ISLAND_STATUS_STEPS.length);
}

export function resolveVisibleIslandStatusSteps(
  history: IslandStatusStep[],
  stage: string | null | undefined,
): IslandStatusStep[] {
  const activeStage = toKnownStage(stage);
  const highestReachedIndex = [activeStage, ...history].reduce(
    (maxIndex, currentStage) => {
      if (!currentStage) return maxIndex;
      return Math.max(maxIndex, ISLAND_STATUS_STEPS.indexOf(currentStage));
    },
    -1,
  );

  return highestReachedIndex >= 0
    ? ISLAND_STATUS_STEPS.slice(0, highestReachedIndex + 1)
    : [];
}

export function resolveIslandRuntimeStatus(
  snapshot: IslandChatSnapshotLike,
  pendingApproval: IslandApproval | null,
  previousHistory: IslandStatusStep[],
): IslandRuntimeStatus {
  let statusStage = snapshot.statusStage;
  let statusCode = snapshot.statusCode;
  let statusMeta = snapshot.statusMeta;

  if (pendingApproval) {
    statusStage = "render";
    statusCode = "approval.required";
    statusMeta = buildApprovalStatusMeta(pendingApproval);
  } else if (!statusStage && !statusCode) {
    const latestAssistant = snapshot.messages.findLast(
      (message) => message.role === "assistant",
    );
    const activity = deriveAssistantActivityState(latestAssistant?.blocks);
    statusStage = activity.statusStage;
    statusCode = activity.statusCode;
    statusMeta = activity.statusMeta;
  }

  return {
    statusStage,
    statusCode,
    statusMeta,
    stageHistory: appendIslandStageHistory(previousHistory, statusStage),
  };
}

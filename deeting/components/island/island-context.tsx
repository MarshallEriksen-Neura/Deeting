"use client";

import { createContext, useContext } from "react";
import type { IslandApproval, IslandMode, IslandRecentMessage } from "./island-store";
import type { IslandStatusStep } from "./island-runtime-status";
import type { IslandBrowserLookupPayload } from "./browser-lookup-types";
import type {
  IslandSelectionActionKind,
  IslandSelectionContext,
} from "./selection-context-types";
import type { SelectionActionPromptOptions } from "./selection-action-prompts";

export interface IslandContextValue {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  lastReplyAt: number | null;
  recentMessages: IslandRecentMessage[];
  pendingApproval: IslandApproval | null;
  browserLookup: IslandBrowserLookupPayload | null;
  selectionContext: IslandSelectionContext | null;
  isBusy: boolean;
  errorMessage: string | null;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  stageHistory: IslandStatusStep[];
  collapsedHighlight:
    | {
        tone: "success" | "pending";
        labelKey: string;
        detailKey?: string | null;
      }
    | null;

  expand: () => void;
  collapse: () => void;
  hide: () => void;
  toggleExpand: () => void;
  restoreWorkspace: () => void;
  sendQuickReply: (text: string) => Promise<void>;
  approvePendingApproval: () => Promise<void>;
  rejectPendingApproval: () => Promise<void>;
  attachBrowserLookup: (lookupId: string, prompt: string) => Promise<void> | void;
  dismissBrowserLookup: (lookupId: string) => Promise<void> | void;
  runSelectionAction: (
    kind: IslandSelectionActionKind,
    options?: SelectionActionPromptOptions
  ) => Promise<void> | void;
  dismissSelectionContext: (selectionId?: string | null) => Promise<void> | void;
}

const IslandContext = createContext<IslandContextValue | null>(null);

export function IslandProvider({
  value,
  children,
}: {
  value: IslandContextValue;
  children: React.ReactNode;
}) {
  return (
    <IslandContext.Provider value={value}>{children}</IslandContext.Provider>
  );
}

export function useIslandContext(): IslandContextValue {
  const ctx = useContext(IslandContext);
  if (!ctx) {
    throw new Error("useIslandContext must be used within an IslandProvider");
  }
  return ctx;
}

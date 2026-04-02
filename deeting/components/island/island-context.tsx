"use client";

import { createContext, useContext } from "react";
import type { IslandApproval, IslandMode } from "./island-store";

export interface IslandContextValue {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  pendingApproval: IslandApproval | null;
  isBusy: boolean;
  errorMessage: string | null;

  expand: () => void;
  collapse: () => void;
  hide: () => void;
  toggleExpand: () => void;
  restoreWorkspace: () => void;
  sendQuickReply: (text: string) => Promise<void>;
  approvePendingApproval: () => Promise<void>;
  rejectPendingApproval: () => Promise<void>;
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

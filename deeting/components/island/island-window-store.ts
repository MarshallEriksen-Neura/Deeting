"use client";

import { create } from "zustand";

import {
  approveIslandTool,
  executeIslandTextConversation,
  rejectIslandTool,
} from "@/lib/api/island";
import type { IslandApproval, IslandMode } from "./island-store";

interface IslandWindowState {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  pendingApproval: IslandApproval | null;
  isBusy: boolean;
  errorMessage: string | null;
  sessionId: string | null;

  expand: () => void;
  collapse: () => void;
  hide: () => void;
  toggleExpand: () => void;
  restoreWorkspace: () => void;
  syncFromEvent: (payload: IslandSyncPayload) => void;
  sendQuickReply: (text: string) => Promise<void>;
  approvePendingApproval: () => Promise<void>;
  rejectPendingApproval: () => Promise<void>;
}

export interface IslandSyncPayload {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  pendingApproval: IslandApproval | null;
  isBusy: boolean;
  errorMessage: string | null;
  sessionId: string | null;
}

async function emitActionCompleted() {
  const { emit } = await import("@tauri-apps/api/event");
  await emit("island:action-completed", {});
}

export const useIslandWindowStore = create<IslandWindowState>((set, get) => ({
  mode: "collapsed",
  statusLabel: "Idle",
  summaryText: "Connecting to workspace...",
  lastReplyText: "No replies yet.",
  pendingApproval: null,
  isBusy: false,
  errorMessage: null,
  sessionId: null,

  expand: () => set({ mode: "expanded" }),
  collapse: () => set({ mode: "collapsed" }),
  hide: () => set({ mode: "hidden" }),
  toggleExpand: () =>
    set((state) => ({
      mode: state.mode === "expanded" ? "collapsed" : "expanded",
    })),

  restoreWorkspace: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("show_main_hide_island");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore workspace";
      set({ errorMessage: message });
    }
  },

  syncFromEvent: (payload) => {
    set({
      mode: payload.mode,
      statusLabel: payload.statusLabel,
      summaryText: payload.summaryText,
      lastReplyText: payload.lastReplyText,
      pendingApproval: payload.pendingApproval,
      isBusy: payload.isBusy,
      errorMessage: payload.errorMessage,
      sessionId: payload.sessionId,
    });
  },

  sendQuickReply: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const sessionId = get().sessionId;
    if (!sessionId) {
      set({ errorMessage: "No active session" });
      return;
    }

    set({ isBusy: true, errorMessage: null });
    try {
      await executeIslandTextConversation(sessionId, trimmed);
      await emitActionCompleted();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Island send failed";
      set({ errorMessage: message });
    } finally {
      set({ isBusy: false });
    }
  },

  approvePendingApproval: async () => {
    const approval = get().pendingApproval;
    if (!approval) return;

    set({ isBusy: true, errorMessage: null });
    try {
      await approveIslandTool(
        approval.approvalToken,
        approval.toolName,
        approval.callId
      );
      await emitActionCompleted();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Island approval failed";
      set({ errorMessage: message });
    } finally {
      set({ isBusy: false });
    }
  },

  rejectPendingApproval: async () => {
    const approval = get().pendingApproval;
    if (!approval) return;

    set({ isBusy: true, errorMessage: null });
    try {
      await rejectIslandTool(approval.approvalToken, approval.toolName);
      await emitActionCompleted();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Island rejection failed";
      set({ errorMessage: message });
    } finally {
      set({ isBusy: false });
    }
  },
}));

"use client"

import { create } from "zustand"

export type BrowserModeStatus =
  | "idle"
  | "pending_confirmation"
  | "connecting"
  | "active"
  | "paused"
  | "recovering"
  | "ended"

export interface BrowserModeRequest {
  prompt: string
  source: "chat"
}

export interface BrowserModePageContext {
  tabId: number | null
  title: string
  url: string
  host: string
}

export interface BrowserModeActionSummary {
  kind: string
  summary: string
}

export interface BrowserModeTimelineEntry {
  id: string
  kind: "tool_call" | "tool_result" | "system"
  label: string
  phase: BrowserModeExecutionPhase
  createdAt: number
}

export type BrowserModeExecutionPhase =
  | "idle"
  | "waiting"
  | "acting"
  | "verifying"
  | "recovering"

interface ActivatePayload {
  connectionLabel: string
  page: BrowserModePageContext | null
  lastAction?: BrowserModeActionSummary | null
}

interface BrowserModeState {
  status: BrowserModeStatus
  executionPhase: BrowserModeExecutionPhase
  executionLabel: string | null
  retryCount: number
  recoveryReason: string | null
  request: BrowserModeRequest | null
  connectionLabel: string | null
  page: BrowserModePageContext | null
  lastAction: BrowserModeActionSummary | null
  timeline: BrowserModeTimelineEntry[]
  endedSummary: string | null
  requestBrowserMode: (request: BrowserModeRequest) => void
  confirm: () => void
  decline: () => void
  activate: (payload: ActivatePayload) => void
  pause: (label?: string | null) => void
  reconnect: (label?: string | null) => void
  markDisconnected: (label?: string | null) => void
  setExecutionState: (
    phase: BrowserModeExecutionPhase,
    label?: string | null
  ) => void
  markRecovery: (reason: string, retryCount: number) => void
  setLastAction: (action: BrowserModeActionSummary | null) => void
  mergePage: (page: Partial<BrowserModePageContext>) => void
  appendTimelineEvent: (
    entry: Omit<BrowserModeTimelineEntry, "id" | "createdAt">
  ) => void
  end: (summary?: string | null) => void
  reset: () => void
}

const initialState = {
  status: "idle" as BrowserModeStatus,
  executionPhase: "idle" as BrowserModeExecutionPhase,
  executionLabel: null as string | null,
  retryCount: 0,
  recoveryReason: null as string | null,
  request: null as BrowserModeRequest | null,
  connectionLabel: null as string | null,
  page: null as BrowserModePageContext | null,
  lastAction: null as BrowserModeActionSummary | null,
  timeline: [] as BrowserModeTimelineEntry[],
  endedSummary: null as string | null,
}

export const useBrowserModeStore = create<BrowserModeState>()((set) => ({
  ...initialState,
  requestBrowserMode: (request) =>
    set({
      status: "pending_confirmation",
      executionPhase: "idle",
      executionLabel: null,
      retryCount: 0,
      recoveryReason: null,
      request,
      connectionLabel: null,
      timeline: [],
      endedSummary: null,
    }),
  confirm: () =>
    set((state) => ({
      status: "connecting",
      executionPhase: "waiting",
      executionLabel: null,
      request: state.request,
      endedSummary: null,
    })),
  decline: () =>
    set({
      ...initialState,
    }),
  activate: ({ connectionLabel, page, lastAction }) =>
    set((state) => ({
      status: "active",
      executionPhase: "acting",
      executionLabel: null,
      retryCount: 0,
      recoveryReason: null,
      request: state.request,
      connectionLabel,
      page,
      lastAction: lastAction ?? state.lastAction,
      timeline: state.timeline,
      endedSummary: null,
    })),
  pause: (label) =>
    set((state) => ({
      status: "paused",
      executionPhase: state.executionPhase,
      request: state.request,
      connectionLabel: label ?? state.connectionLabel,
    })),
  reconnect: (label) =>
    set((state) => ({
      status: "connecting",
      executionPhase: "recovering",
      executionLabel: label ?? state.executionLabel,
      request: state.request,
      connectionLabel: label ?? state.connectionLabel,
    })),
  markDisconnected: (label) =>
    set((state) => ({
      status: "recovering",
      executionPhase: "recovering",
      executionLabel: label ?? state.executionLabel,
      request: state.request,
      connectionLabel: label ?? state.connectionLabel,
    })),
  setExecutionState: (phase, label) =>
    set({
      executionPhase: phase,
      executionLabel: label ?? null,
    }),
  markRecovery: (reason, retryCount) =>
    set((state) => ({
      status: "recovering",
      executionPhase: "recovering",
      executionLabel: reason,
      retryCount,
      recoveryReason: reason,
      request: state.request,
    })),
  setLastAction: (action) =>
    set({
      lastAction: action,
    }),
  mergePage: (page) =>
    set((state) => ({
      page: state.page
        ? {
            ...state.page,
            ...page,
          }
        : {
            tabId: null,
            title: "",
            url: "",
            host: "",
            ...page,
          },
    })),
  appendTimelineEvent: (entry) =>
    set((state) => {
      const nextEntry: BrowserModeTimelineEntry = {
        ...entry,
        id: `browser-mode-timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      }
      const nextTimeline = [...state.timeline, nextEntry].slice(-12)
      return {
        timeline: nextTimeline,
      }
    }),
  end: (summary) =>
    set((state) => ({
      status: "ended",
      executionPhase: "idle",
      executionLabel: null,
      request: state.request,
      connectionLabel: state.connectionLabel,
      page: null,
      lastAction: state.lastAction,
      timeline: state.timeline,
      endedSummary: summary ?? null,
    })),
  reset: () =>
    set({
      ...initialState,
    }),
}))

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

interface ActivatePayload {
  connectionLabel: string
  page: BrowserModePageContext | null
  lastAction?: BrowserModeActionSummary | null
}

interface BrowserModeState {
  status: BrowserModeStatus
  request: BrowserModeRequest | null
  connectionLabel: string | null
  page: BrowserModePageContext | null
  lastAction: BrowserModeActionSummary | null
  endedSummary: string | null
  requestBrowserMode: (request: BrowserModeRequest) => void
  confirm: () => void
  decline: () => void
  activate: (payload: ActivatePayload) => void
  pause: (label?: string | null) => void
  reconnect: (label?: string | null) => void
  markDisconnected: (label?: string | null) => void
  end: (summary?: string | null) => void
  reset: () => void
}

const initialState = {
  status: "idle" as BrowserModeStatus,
  request: null as BrowserModeRequest | null,
  connectionLabel: null as string | null,
  page: null as BrowserModePageContext | null,
  lastAction: null as BrowserModeActionSummary | null,
  endedSummary: null as string | null,
}

export const useBrowserModeStore = create<BrowserModeState>()((set) => ({
  ...initialState,
  requestBrowserMode: (request) =>
    set({
      status: "pending_confirmation",
      request,
      connectionLabel: null,
      endedSummary: null,
    }),
  confirm: () =>
    set((state) => ({
      status: "connecting",
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
      request: state.request,
      connectionLabel,
      page,
      lastAction: lastAction ?? state.lastAction,
      endedSummary: null,
    })),
  pause: (label) =>
    set((state) => ({
      status: "paused",
      request: state.request,
      connectionLabel: label ?? state.connectionLabel,
    })),
  reconnect: (label) =>
    set((state) => ({
      status: "connecting",
      request: state.request,
      connectionLabel: label ?? state.connectionLabel,
    })),
  markDisconnected: (label) =>
    set((state) => ({
      status: "recovering",
      request: state.request,
      connectionLabel: label ?? state.connectionLabel,
    })),
  end: (summary) =>
    set((state) => ({
      status: "ended",
      request: state.request,
      connectionLabel: state.connectionLabel,
      page: null,
      lastAction: state.lastAction,
      endedSummary: summary ?? null,
    })),
  reset: () =>
    set({
      ...initialState,
    }),
}))

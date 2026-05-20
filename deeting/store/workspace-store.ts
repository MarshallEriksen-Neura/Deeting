"use client"

import { create } from "zustand"

export type WorkspaceViewType = "native-canvas" | "plugin-iframe" | "browser-mode"

export interface BaseWorkspaceView {
  id: string
  type: WorkspaceViewType
  title: string
  keepAlive?: boolean
  lastActiveAt: number
}

export interface NativeCanvasView extends BaseWorkspaceView {
  type: "native-canvas"
  content: Record<string, unknown>
}

export interface WorkflowCanvasContent extends Record<string, unknown> {
  viewType: "workflow"
  goal?: string
  runId?: string
  phaseId?: string
  contextPhaseId?: string
}

export interface PluginIframeView extends BaseWorkspaceView {
  type: "plugin-iframe"
  content: { url: string }
}

export interface BrowserModeView extends BaseWorkspaceView {
  type: "browser-mode"
  content: { source: string }
}

export type WorkspaceView = NativeCanvasView | PluginIframeView | BrowserModeView

export type WorkflowCanvasView = NativeCanvasView & {
  content: WorkflowCanvasContent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isWorkflowCanvasView(view: WorkspaceView): view is WorkflowCanvasView {
  if (view.type !== "native-canvas") return false
  const content = view.content
  if (!isRecord(content) || content.viewType !== "workflow") return false
  return (
    (typeof content.goal === "string" || typeof content.goal === "undefined") &&
    (typeof content.runId === "string" || typeof content.runId === "undefined") &&
    (typeof content.phaseId === "string" || typeof content.phaseId === "undefined") &&
    (typeof content.contextPhaseId === "string" || typeof content.contextPhaseId === "undefined")
  )
}

interface WorkspaceState {
  views: WorkspaceView[]
  activeViewId: string | null
  maxViews: number
  openView: (view: Omit<WorkspaceView, "lastActiveAt">) => void
  closeView: (id: string) => void
  switchView: (id: string) => void
  closeAll: () => void
}

const defaultMaxViews = 5

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  views: [],
  activeViewId: null,
  maxViews: defaultMaxViews,
  openView: (view) => {
    const now = Date.now()
    set((state) => {
      const existing = state.views.find((item) => item.id === view.id)
      if (existing) {
        const nextViews = state.views.map((item) => {
          if (item.id !== view.id) return item
          if (view.type === "plugin-iframe") {
            const iframeView = view as Omit<PluginIframeView, "lastActiveAt">
            return {
              ...item,
              ...iframeView,
              type: "plugin-iframe" as const,
              content: iframeView.content,
              lastActiveAt: now,
            }
          }
          if (view.type === "browser-mode") {
            const browserModeView = view as Omit<BrowserModeView, "lastActiveAt">
            return {
              ...item,
              ...browserModeView,
              type: "browser-mode" as const,
              content: browserModeView.content,
              lastActiveAt: now,
            }
          }
          const canvasView = view as Omit<NativeCanvasView, "lastActiveAt">
          return {
            ...item,
            ...canvasView,
            type: "native-canvas" as const,
            content: canvasView.content,
            lastActiveAt: now,
          }
        }) as WorkspaceView[]
        return { views: nextViews, activeViewId: view.id }
      }

      let nextViews = [...state.views]
      if (nextViews.length >= state.maxViews) {
        const oldest = nextViews.reduce((prev, curr) =>
          curr.lastActiveAt < prev.lastActiveAt ? curr : prev
        )
        nextViews = nextViews.filter((item) => item.id !== oldest.id)
      }

      const nextView: WorkspaceView =
        view.type === "plugin-iframe"
          ? {
              ...(view as Omit<PluginIframeView, "lastActiveAt">),
              type: "plugin-iframe",
              content: (view as Omit<PluginIframeView, "lastActiveAt">).content,
              keepAlive: view.keepAlive ?? true,
              lastActiveAt: now,
            }
          : view.type === "browser-mode"
            ? {
                ...(view as Omit<BrowserModeView, "lastActiveAt">),
                type: "browser-mode",
                content: (view as Omit<BrowserModeView, "lastActiveAt">).content,
                keepAlive: view.keepAlive ?? true,
                lastActiveAt: now,
              }
          : {
              ...(view as Omit<NativeCanvasView, "lastActiveAt">),
              type: "native-canvas",
              content: (view as Omit<NativeCanvasView, "lastActiveAt">).content,
              keepAlive: view.keepAlive ?? true,
              lastActiveAt: now,
            }

      return { views: [...nextViews, nextView], activeViewId: view.id }
    })
  },
  closeView: (id) => {
    set((state) => {
      const nextViews = state.views.filter((view) => view.id !== id)
      let nextActiveId = state.activeViewId
      if (state.activeViewId === id) {
        nextActiveId = nextViews.at(-1)?.id ?? null
      }
      return { views: nextViews, activeViewId: nextActiveId }
    })
  },
  switchView: (id) => {
    const now = Date.now()
    set((state) => ({
      activeViewId: id,
      views: state.views.map((view) =>
        view.id === id ? { ...view, lastActiveAt: now } : view
      ),
    }))
  },
  closeAll: () => set({ views: [], activeViewId: null }),
}))

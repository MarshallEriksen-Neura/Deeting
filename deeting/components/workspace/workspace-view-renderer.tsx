"use client"

import type { WorkspaceView } from "@/store/workspace-store"
import { BrowserModePanelView } from "./browser-mode-panel-view"
import { PluginIframeRenderer } from "./plugin-iframe"
import { NativeCanvasRenderer } from "./native-canvas"

export function WorkspaceViewRenderer({
  view,
  active,
}: {
  view: WorkspaceView
  active: boolean
}) {
  if (view.type === "plugin-iframe") {
    return <PluginIframeRenderer url={view.content.url} active={active} />
  }

  if (view.type === "browser-mode") {
    return <BrowserModePanelView view={view} />
  }

  return <NativeCanvasRenderer view={view} />
}

"use client"

import type { WorkspaceView } from "@/store/workspace-store"
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

  return <NativeCanvasRenderer view={view} />
}

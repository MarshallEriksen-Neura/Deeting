"use client"

import type { BrowserModeView } from "@/store/workspace-store"
import { BrowserModePanel } from "./browser-mode-panel"

export function BrowserModePanelView({ view }: { view: BrowserModeView }) {
  return <BrowserModePanel viewId={view.id} title={view.title} />
}

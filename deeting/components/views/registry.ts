"use client"

import type { ComponentType } from "react"
import dynamic from "next/dynamic"

export interface NativeViewProps<T = unknown> {
  data: T
  title?: string
  metadata?: Record<string, unknown>
}

type NativeViewComponent = ComponentType<NativeViewProps>

const NativeRegistry: Record<string, NativeViewComponent> = {
  "table.v1": dynamic(() => import("./native-table"), { ssr: false }) as unknown as NativeViewComponent,
  "chart.line": dynamic(() => import("./native-line-chart"), { ssr: false }) as unknown as NativeViewComponent,
  "plugin.iframe": dynamic(() => import("./plugin-iframe-view"), { ssr: false }) as unknown as NativeViewComponent,
  "generated.file": dynamic(() => import("./generated-file-view"), { ssr: false }) as unknown as NativeViewComponent,
}

export function resolveNativeView(viewType: string): NativeViewComponent | null {
  return NativeRegistry[viewType] ?? null
}

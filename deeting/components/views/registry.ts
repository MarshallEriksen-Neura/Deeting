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
  "html.v1": dynamic(() => import("./html-runtime-view"), { ssr: false }) as unknown as NativeViewComponent,
  "generated.file": dynamic(() => import("./generated-file-view"), { ssr: false }) as unknown as NativeViewComponent,
  "image.result": dynamic(() => import("./image-result-view"), { ssr: false }) as unknown as NativeViewComponent,
  "audio.result": dynamic(() => import("./audio-result-view"), { ssr: false }) as unknown as NativeViewComponent,
  "execution.lifecycle": dynamic(() => import("./execution-lifecycle-view"), { ssr: false }) as unknown as NativeViewComponent,
  "workflow.result": dynamic(() => import("./workflow-result-view"), { ssr: false }) as unknown as NativeViewComponent,
  "workflow.live": dynamic(() => import("./workflow-live-card"), { ssr: false }) as unknown as NativeViewComponent,
  "workflow.plan": dynamic(() => import("./workflow-plan-card"), { ssr: false }) as unknown as NativeViewComponent,
}

export function resolveNativeView(viewType: string): NativeViewComponent | null {
  return NativeRegistry[viewType] ?? null
}

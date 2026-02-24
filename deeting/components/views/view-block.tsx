"use client"

import { memo } from "react"
import { resolveNativeView } from "./registry"
import { ViewCard } from "./view-card"
import { FallbackJsonView } from "./fallback-json-view"

interface ViewBlockProps {
  viewType: string
  payload: unknown
  title?: string
  metadata?: Record<string, unknown>
}

export const ViewBlock = memo<ViewBlockProps>(function ViewBlock({
  viewType,
  payload,
  title,
  metadata,
}) {
  const NativeComponent = resolveNativeView(viewType)

  if (NativeComponent) {
    return (
      <ViewCard title={title} viewType={viewType}>
        <NativeComponent data={payload} title={title} metadata={metadata} />
      </ViewCard>
    )
  }

  return <FallbackJsonView data={payload} viewType={viewType} title={title} />
})

export default ViewBlock

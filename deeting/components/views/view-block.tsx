"use client"

import { createElement, memo, useMemo } from "react"
import { resolveNativeView } from "./registry"
import { ViewCard } from "./view-card"
import { FallbackJsonView } from "./fallback-json-view"

interface ViewBlockProps {
  viewType: string
  payload: unknown
  title?: string
  metadata?: Record<string, unknown>
}

export function rendersWithoutViewCard(viewType: string) {
  return viewType === "html.v1" || viewType === "image.result" || viewType === "execution.lifecycle"
}

export const ViewBlock = memo<ViewBlockProps>(function ViewBlock({
  viewType,
  payload,
  title,
  metadata,
}) {
  const NativeComponent = useMemo(() => resolveNativeView(viewType), [viewType])

  if (NativeComponent) {
    if (rendersWithoutViewCard(viewType)) {
      return createElement(NativeComponent, { data: payload, title, metadata })
    }

    return (
      <ViewCard title={title} viewType={viewType}>
        {createElement(NativeComponent, { data: payload, title, metadata })}
      </ViewCard>
    )
  }

  return <FallbackJsonView data={payload} viewType={viewType} title={title} />
})

export default ViewBlock


import { useMemo } from 'react'
import type { SpecConnection } from '@/lib/api/spec-agent'

export const useCanvasFocus = (
  selectedNodeId: string | null,
  activeNodeId: string | null,
  connections: SpecConnection[]
) => {
  return useMemo(() => {
    const focusId = selectedNodeId || activeNodeId
    if (!focusId) return null
    const next = new Set([focusId])
    connections.forEach((conn) => {
      if (conn.source === focusId) next.add(conn.target)
      if (conn.target === focusId) next.add(conn.source)
    })
    return next
  }, [connections, selectedNodeId, activeNodeId])
}

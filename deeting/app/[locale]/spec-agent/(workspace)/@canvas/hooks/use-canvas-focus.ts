import { useMemo } from 'react'
import type { SpecConnection } from '@/lib/api/spec-agent'

export const useCanvasFocus = (
  selectedNodeId: string | null,
  connections: SpecConnection[]
) => {
  return useMemo(() => {
    if (!selectedNodeId) return null
    const next = new Set([selectedNodeId])
    connections.forEach((conn) => {
      if (conn.source === selectedNodeId) next.add(conn.target)
      if (conn.target === selectedNodeId) next.add(conn.source)
    })
    return next
  }, [connections, selectedNodeId])
}

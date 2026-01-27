import { useMemo } from 'react'
import type { SpecConnection } from '@/lib/api/spec-agent'
import type { SpecUiNode } from '@/store/spec-agent-store'

export const useCriticalPath = (
  nodes: SpecUiNode[],
  connections: SpecConnection[]
) => {
  return useMemo(() => {
    if (!nodes.length || !connections.length) {
      return { nodes: new Set<string>(), edges: new Set<string>() }
    }

    const nodeIds = new Set(nodes.map((node) => node.id))
    const outgoing = new Map<string, string[]>()
    const indegree = new Map<string, number>()
    nodeIds.forEach((id) => {
      outgoing.set(id, [])
      indegree.set(id, 0)
    })
    connections.forEach((conn) => {
      if (!nodeIds.has(conn.source) || !nodeIds.has(conn.target)) return
      outgoing.get(conn.source)?.push(conn.target)
      indegree.set(conn.target, (indegree.get(conn.target) ?? 0) + 1)
    })

    const queue: string[] = []
    indegree.forEach((count, id) => {
      if (count === 0) queue.push(id)
    })

    const dist = new Map<string, number>()
    const prev = new Map<string, string | null>()
    nodeIds.forEach((id) => {
      dist.set(id, 0)
      prev.set(id, null)
    })

    while (queue.length) {
      const current = queue.shift() as string
      const currentDist = dist.get(current) ?? 0
      const neighbors = outgoing.get(current) ?? []
      neighbors.forEach((next) => {
        if (currentDist + 1 > (dist.get(next) ?? 0)) {
          dist.set(next, currentDist + 1)
          prev.set(next, current)
        }
        indegree.set(next, (indegree.get(next) ?? 1) - 1)
        if (indegree.get(next) === 0) queue.push(next)
      })
    }

    let endNode = nodes[0]?.id ?? ''
    let maxDist = -1
    dist.forEach((value, id) => {
      if (value > maxDist) {
        maxDist = value
        endNode = id
      }
    })

    const pathNodes = new Set<string>()
    const pathEdges = new Set<string>()
    let cursor: string | null = endNode
    while (cursor) {
      pathNodes.add(cursor)
      const parent = prev.get(cursor) ?? null
      if (parent) pathEdges.add(`${parent}=>${cursor}`)
      cursor = parent
    }

    return { nodes: pathNodes, edges: pathEdges }
  }, [connections, nodes])
}

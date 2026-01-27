import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SpecConnection } from '@/lib/api/spec-agent'
import type { SpecUiNode } from '@/store/spec-agent-store'

type CriticalPath = { nodes: Set<string>; edges: Set<string> }

type BranchData = {
  rootId: string
  originId: string
  nodes: Set<string>
}

const buildBranchData = (
  nodes: SpecUiNode[],
  connections: SpecConnection[],
  criticalPath: CriticalPath
) => {
  if (!criticalPath.nodes.size || !connections.length) return [] as BranchData[]
  const outgoing = new Map<string, string[]>()
  nodes.forEach((node) => outgoing.set(node.id, []))
  connections.forEach((conn) => {
    outgoing.get(conn.source)?.push(conn.target)
  })

  const roots = new Map<string, { originId: string; nodes: Set<string> }>()
  connections.forEach((conn) => {
    if (!criticalPath.nodes.has(conn.source)) return
    if (criticalPath.nodes.has(conn.target)) return
    if (roots.has(conn.target)) return

    const visited = new Set<string>()
    const stack = [conn.target]
    while (stack.length) {
      const current = stack.pop() as string
      if (visited.has(current)) continue
      if (criticalPath.nodes.has(current)) continue
      visited.add(current)
      const nextNodes = outgoing.get(current) ?? []
      nextNodes.forEach((next) => {
        if (!criticalPath.nodes.has(next)) stack.push(next)
      })
    }

    roots.set(conn.target, { originId: conn.source, nodes: visited })
  })

  return Array.from(roots.entries()).map(([rootId, data]) => ({
    rootId,
    originId: data.originId,
    nodes: data.nodes,
  }))
}

export const useBranchState = ({
  nodes,
  connections,
  criticalPath,
  planId,
  selectedNodeId,
  setSelectedNodeId,
}: {
  nodes: SpecUiNode[]
  connections: SpecConnection[]
  criticalPath: CriticalPath
  planId: string | null
  selectedNodeId: string | null
  setSelectedNodeId: (nodeId: string | null) => void
}) => {
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(
    () => new Set()
  )
  const [collapseHydrated, setCollapseHydrated] = useState(false)
  const [criticalLocked, setCriticalLocked] = useState(false)
  const [lockedSnapshot, setLockedSnapshot] = useState<Set<string> | null>(null)

  const branchData = useMemo(
    () => buildBranchData(nodes, connections, criticalPath),
    [connections, criticalPath, nodes]
  )
  const branchRootKey = useMemo(
    () => branchData.map((item) => item.rootId).sort().join('|'),
    [branchData]
  )

  useEffect(() => {
    if (!planId) {
      setCollapsedBranches(new Set())
      setCollapseHydrated(false)
      setCriticalLocked(false)
      setLockedSnapshot(null)
      return
    }
    const storageKey = `deeting-spec-agent:branch-collapse:${planId}`
    const stored = localStorage.getItem(storageKey)
    if (!stored) {
      setCollapsedBranches(new Set())
      setCollapseHydrated(false)
      setCriticalLocked(false)
      setLockedSnapshot(null)
      return
    }
    try {
      const parsed = JSON.parse(stored)
      const ids = Array.isArray(parsed) ? parsed.filter(Boolean) : []
      setCollapsedBranches(new Set(ids))
      setCollapseHydrated(true)
      setCriticalLocked(false)
      setLockedSnapshot(null)
    } catch {
      setCollapsedBranches(new Set())
      setCollapseHydrated(false)
      setCriticalLocked(false)
      setLockedSnapshot(null)
    }
  }, [planId])

  useEffect(() => {
    if (!branchData.length) {
      setCollapsedBranches(new Set())
      return
    }
    if (criticalLocked) {
      setCollapsedBranches(new Set(branchData.map((item) => item.rootId)))
      return
    }
    setCollapsedBranches((prev) => {
      const next = new Set(prev)
      const nextRoots = new Set(branchData.map((item) => item.rootId))
      if (!collapseHydrated) {
        nextRoots.forEach((id) => {
          if (!next.has(id)) next.add(id)
        })
        setCollapseHydrated(true)
      }
      Array.from(next).forEach((id) => {
        if (!nextRoots.has(id)) next.delete(id)
      })
      return next
    })
  }, [branchData, branchRootKey, collapseHydrated, criticalLocked])

  useEffect(() => {
    if (!planId || !collapseHydrated || criticalLocked) return
    const storageKey = `deeting-spec-agent:branch-collapse:${planId}`
    localStorage.setItem(
      storageKey,
      JSON.stringify(Array.from(collapsedBranches))
    )
  }, [collapsedBranches, collapseHydrated, criticalLocked, planId])

  const hiddenNodes = useMemo(() => {
    if (!branchData.length) return new Set<string>()
    const hidden = new Set<string>()
    branchData.forEach((branch) => {
      if (!collapsedBranches.has(branch.rootId)) return
      branch.nodes.forEach((nodeId) => {
        if (nodeId !== branch.rootId) hidden.add(nodeId)
      })
    })
    return hidden
  }, [branchData, collapsedBranches])

  const visibleNodes = useMemo(
    () => nodes.filter((node) => !hiddenNodes.has(node.id)),
    [hiddenNodes, nodes]
  )
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes]
  )
  const visibleNodeMap = useMemo(
    () => new Map(visibleNodes.map((node) => [node.id, node])),
    [visibleNodes]
  )
  const visibleConnections = useMemo(
    () =>
      connections.filter(
        (conn) =>
          visibleNodeIds.has(conn.source) && visibleNodeIds.has(conn.target)
      ),
    [connections, visibleNodeIds]
  )

  useEffect(() => {
    if (!selectedNodeId) return
    if (hiddenNodes.has(selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [hiddenNodes, selectedNodeId, setSelectedNodeId])

  const toggleBranch = useCallback(
    (rootId: string) => {
      if (criticalLocked) return
      setCollapsedBranches((prev) => {
        const next = new Set(prev)
        if (next.has(rootId)) {
          next.delete(rootId)
        } else {
          next.add(rootId)
        }
        return next
      })
    },
    [criticalLocked]
  )

  const branchToggles = useMemo(() => {
    return branchData
      .map((branch) => {
        const rootNode = visibleNodeMap.get(branch.rootId)
        if (!rootNode) return null
        const hiddenCount = Math.max(branch.nodes.size - 1, 0)
        if (hiddenCount === 0) return null
        return {
          id: branch.rootId,
          position: rootNode.position,
          hiddenCount,
          collapsed: collapsedBranches.has(branch.rootId),
        }
      })
      .filter(Boolean)
  }, [branchData, collapsedBranches, visibleNodeMap])

  const branchBadges = useMemo(() => {
    const badgeMap = new Map<string, string>()
    branchData.forEach((branch) => {
      if (!collapsedBranches.has(branch.rootId)) return
      const hiddenCount = Math.max(branch.nodes.size - 1, 0)
      if (hiddenCount === 0) return
      badgeMap.set(branch.rootId, `+${hiddenCount}`)
    })
    return badgeMap
  }, [branchData, collapsedBranches])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'l') return
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName?.toLowerCase()
        if (
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          target.isContentEditable
        ) {
          return
        }
      }
      event.preventDefault()
      if (!criticalLocked) {
        setLockedSnapshot(new Set(collapsedBranches))
        setCollapsedBranches(new Set(branchData.map((item) => item.rootId)))
        setCriticalLocked(true)
        return
      }
      setCollapsedBranches(lockedSnapshot ?? new Set())
      setLockedSnapshot(null)
      setCriticalLocked(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [branchData, collapsedBranches, criticalLocked, lockedSnapshot])

  return {
    visibleNodes,
    visibleConnections,
    branchToggles,
    branchBadges,
    criticalLocked,
    toggleBranch,
  }
}

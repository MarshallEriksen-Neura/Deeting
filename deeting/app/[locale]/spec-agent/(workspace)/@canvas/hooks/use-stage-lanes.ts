import { useMemo } from 'react'
import type { SpecUiNode } from '@/store/spec-agent-store'

export type CanvasStageLane = {
  key: string
  label: string
  tone: string
  top: number
  height: number
}

export const useStageLanes = (nodes: SpecUiNode[], t: (key: string) => string) =>
  useMemo(() => {
    const lanePadding = 80
    const stages = [
      {
        key: 'search',
        label: t('canvas.stage.search'),
        tone: 'bg-blue-500/5 border-blue-500/20 text-blue-500/70',
      },
      {
        key: 'process',
        label: t('canvas.stage.process'),
        tone: 'bg-violet-500/5 border-violet-500/20 text-violet-500/70',
      },
      {
        key: 'summary',
        label: t('canvas.stage.summary'),
        tone: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-500/70',
      },
      {
        key: 'action',
        label: t('canvas.stage.action'),
        tone: 'bg-amber-500/5 border-amber-500/20 text-amber-500/70',
      },
    ]

    return stages
      .map((stage) => {
        const stageNodes = nodes.filter((node) => node.stage === stage.key)
        if (!stageNodes.length) return null
        const minY = Math.min(...stageNodes.map((node) => node.position.y))
        const maxY = Math.max(...stageNodes.map((node) => node.position.y))
        const top = Math.max(minY - lanePadding, 0)
        const height = Math.max(maxY - minY + lanePadding * 2, 180)
        return { ...stage, top, height }
      })
      .filter((lane): lane is CanvasStageLane => Boolean(lane))
  }, [nodes, t])

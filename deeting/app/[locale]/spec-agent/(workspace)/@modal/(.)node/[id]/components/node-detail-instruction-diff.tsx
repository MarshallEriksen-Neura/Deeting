'use client'

import { memo, useMemo } from 'react'
import { Label } from '@/components/ui/label'

type NodeDetailInstructionDiffProps = {
  t: (key: string) => string
  original: string
  updated: string
}

type DiffToken = { text: string; type: 'same' | 'add' | 'remove' }

const buildDiff = (a: string[], b: string[]): DiffToken[] => {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const tokens: DiffToken[] = []
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      tokens.unshift({ text: a[i - 1], type: 'same' })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tokens.unshift({ text: b[j - 1], type: 'add' })
      j -= 1
    } else if (i > 0) {
      tokens.unshift({ text: a[i - 1], type: 'remove' })
      i -= 1
    }
  }
  return tokens
}

export const NodeDetailInstructionDiff = memo(function NodeDetailInstructionDiff({
  t,
  original,
  updated,
}: NodeDetailInstructionDiffProps) {
  const tokens = useMemo(() => {
    const originalTokens = original.trim().split(/\s+/)
    const updatedTokens = updated.trim().split(/\s+/)
    return buildDiff(originalTokens, updatedTokens)
  }, [original, updated])

  if (!original || !updated || original === updated) return null

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">
        {t('node.modal.instructionDiff')}
      </Label>
      <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs leading-5">
        {tokens.map((token, index) => {
          const base = token.text
          if (token.type === 'add') {
            return (
              <span key={`${token.text}-${index}`} className="bg-emerald-500/15 text-emerald-600 px-0.5 rounded">
                {base}{' '}
              </span>
            )
          }
          if (token.type === 'remove') {
            return (
              <span key={`${token.text}-${index}`} className="bg-rose-500/10 text-rose-500 line-through px-0.5 rounded">
                {base}{' '}
              </span>
            )
          }
          return <span key={`${token.text}-${index}`}>{base} </span>
        })}
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground">
        <div>
          {t('node.modal.instructionBefore')}: <span className="text-foreground">{original}</span>
        </div>
        <div>
          {t('node.modal.instructionAfter')}: <span className="text-foreground">{updated}</span>
        </div>
      </div>
    </div>
  )
})

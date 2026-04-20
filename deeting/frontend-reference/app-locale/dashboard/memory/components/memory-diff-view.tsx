"use client"

import { memo, useMemo } from "react"

type DiffToken = { text: string; type: "same" | "add" | "remove" }

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
      tokens.unshift({ text: a[i - 1], type: "same" })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tokens.unshift({ text: b[j - 1], type: "add" })
      j -= 1
    } else if (i > 0) {
      tokens.unshift({ text: a[i - 1], type: "remove" })
      i -= 1
    }
  }
  return tokens
}

interface MemoryDiffViewProps {
  oldContent: string
  newContent: string
}

export const MemoryDiffView = memo(function MemoryDiffView({
  oldContent,
  newContent,
}: MemoryDiffViewProps) {
  const tokens = useMemo(() => {
    if (!oldContent || !newContent || oldContent === newContent) return []
    const oldTokens = oldContent.trim().split(/\s+/)
    const newTokens = newContent.trim().split(/\s+/)
    return buildDiff(oldTokens, newTokens)
  }, [oldContent, newContent])

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
        {oldContent || newContent || "No content"}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6">
      {tokens.map((token, index) => {
        if (token.type === "add") {
          return (
            <span
              key={`${index}-${token.text}`}
              className="bg-emerald-500/15 text-emerald-400 px-0.5 rounded"
            >
              {token.text}{" "}
            </span>
          )
        }
        if (token.type === "remove") {
          return (
            <span
              key={`${index}-${token.text}`}
              className="bg-rose-500/10 text-rose-400 line-through px-0.5 rounded"
            >
              {token.text}{" "}
            </span>
          )
        }
        return (
          <span key={`${index}-${token.text}`} className="text-gray-300">
            {token.text}{" "}
          </span>
        )
      })}
    </div>
  )
})

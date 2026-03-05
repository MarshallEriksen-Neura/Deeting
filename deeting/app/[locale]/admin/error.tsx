"use client"

import { useEffect } from "react"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[Admin Error]", error)
  }, [error])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-gray-50 p-6 dark:bg-[#05050A]">
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6 text-center max-w-md">
        <h2 className="text-lg font-semibold text-rose-400">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          An unexpected error occurred while loading this page.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-gray-400">
            {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-4 inline-flex h-9 items-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 text-sm text-rose-300 transition-colors hover:bg-rose-500/20 cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

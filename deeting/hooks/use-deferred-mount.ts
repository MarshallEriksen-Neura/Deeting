"use client"

import * as React from "react"

export function useDeferredMount(delayMs = 0) {
  const [isReady, setIsReady] = React.useState(false)

  React.useEffect(() => {
    let timeoutId: number | null = null
    let firstFrame = 0
    let secondFrame = 0

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timeoutId = window.setTimeout(() => {
          setIsReady(true)
        }, delayMs)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [delayMs])

  return isReady
}

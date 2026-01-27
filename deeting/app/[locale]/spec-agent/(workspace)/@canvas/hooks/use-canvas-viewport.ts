import { useEffect, useRef, useState } from 'react'

export type CanvasViewport = {
  width: number
  height: number
  scrollLeft: number
  scrollTop: number
}

export const useCanvasViewport = () => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef(false)
  const [viewport, setViewport] = useState<CanvasViewport>({
    width: 0,
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const storageKey = 'deeting-spec-agent:canvas-viewport'

    const handle = () => {
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      }
      setViewport(next)
      sessionStorage.setItem(storageKey, JSON.stringify(next))
    }

    handle()
    if (!restoreRef.current) {
      restoreRef.current = true
      const cached = sessionStorage.getItem(storageKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Partial<CanvasViewport>
          requestAnimationFrame(() => {
            element.scrollTo({
              left: parsed.scrollLeft ?? 0,
              top: parsed.scrollTop ?? 0,
            })
          })
        } catch {
          // ignore malformed cache
        }
      }
    }
    element.addEventListener('scroll', handle, { passive: true })
    window.addEventListener('resize', handle)

    return () => {
      element.removeEventListener('scroll', handle)
      window.removeEventListener('resize', handle)
    }
  }, [])

  return { scrollRef, viewport }
}

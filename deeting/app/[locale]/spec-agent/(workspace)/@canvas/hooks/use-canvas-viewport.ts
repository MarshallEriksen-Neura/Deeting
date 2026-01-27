import { useEffect, useRef, useState } from 'react'

export type CanvasViewport = {
  width: number
  height: number
  scrollLeft: number
  scrollTop: number
}

export const useCanvasViewport = () => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<CanvasViewport>({
    width: 0,
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handle = () => {
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      })
    }

    handle()
    element.addEventListener('scroll', handle, { passive: true })
    window.addEventListener('resize', handle)

    return () => {
      element.removeEventListener('scroll', handle)
      window.removeEventListener('resize', handle)
    }
  }, [])

  return { scrollRef, viewport }
}

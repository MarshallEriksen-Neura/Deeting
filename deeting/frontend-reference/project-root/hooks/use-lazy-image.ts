import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * useLazyImage Hook - 图片懒加载
 * 
 * 使用 Intersection Observer API 实现图片懒加载，
 * 当图片进入视口时才开始加载，优化页面性能。
 * 
 * @param options - 配置选项
 * @param options.src - 图片源地址
 * @param options.rootMargin - 根元素的外边距，用于提前加载（默认 '50px'）
 * @param options.threshold - 触发加载的可见度阈值（默认 0.01）
 * @returns 包含图片状态和引用的对象
 * 
 * @example
 * ```tsx
 * function LazyImage({ src, alt }: { src: string; alt: string }) {
 *   const { imageSrc, isLoading, error, imgRef } = useLazyImage({
 *     src,
 *     rootMargin: '50px',
 *     threshold: 0.01
 *   })
 * 
 *   if (error) {
 *     return <div>加载失败</div>
 *   }
 * 
 *   return (
 *     <img
 *       ref={imgRef}
 *       src={imageSrc || undefined}
 *       alt={alt}
 *       style={{ opacity: isLoading ? 0.5 : 1 }}
 *     />
 *   )
 * }
 * ```
 */
export interface UseLazyImageOptions {
  /** 图片源地址 */
  src: string
  /** 根元素的外边距，用于提前加载（默认 '50px'） */
  rootMargin?: string
  /** 触发加载的可见度阈值（默认 0.01） */
  threshold?: number
}

export interface UseLazyImageReturn {
  /** 当前加载的图片地址（未加载时为 null） */
  imageSrc: string | null
  /** 是否正在加载 */
  isLoading: boolean
  /** 加载错误信息 */
  error: Error | null
  /** 图片元素的引用 */
  imgRef: React.RefObject<HTMLImageElement | null>
}

export function useLazyImage({
  src,
  rootMargin = '50px',
  threshold = 0.01,
}: UseLazyImageOptions): UseLazyImageReturn {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // 加载图片的函数
  const loadImage = useCallback(() => {
    if (!src) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    // 创建一个新的 Image 对象来预加载图片
    const img = new Image()

    img.onload = () => {
      setImageSrc(src)
      setIsLoading(false)
      setError(null)
    }

    img.onerror = () => {
      const err = new Error(`Failed to load image: ${src}`)
      setError(err)
      setIsLoading(false)
      setImageSrc(null)
    }

    img.src = src
  }, [src])

  useEffect(() => {
    // 如果没有图片元素引用，直接返回
    if (!imgRef.current) {
      return
    }

    // 检查浏览器是否支持 Intersection Observer
    if (!('IntersectionObserver' in window)) {
      // 不支持则直接加载图片
      loadImage()
      return
    }

    // 创建 Intersection Observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // 当图片进入视口时
          if (entry.isIntersecting) {
            loadImage()
            // 加载后断开观察
            if (observerRef.current && entry.target) {
              observerRef.current.unobserve(entry.target)
            }
          }
        })
      },
      {
        rootMargin,
        threshold,
      }
    )

    // 开始观察图片元素
    observerRef.current.observe(imgRef.current)

    // 清理函数
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [src, rootMargin, threshold, loadImage])

  return {
    imageSrc,
    isLoading,
    error,
    imgRef,
  }
}

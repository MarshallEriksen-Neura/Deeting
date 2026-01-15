"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

export type AmbientState = "idle" | "processing" | "success" | "error" | "warning"

interface AmbientIndicatorProps {
  state: AmbientState
  message?: string
  className?: string
  targetElement?: HTMLElement // 可选：指定目标元素（如输入框）
}

export function AmbientIndicator({ 
  state, 
  message, 
  className,
  targetElement 
}: AmbientIndicatorProps) {
  const [isPulsing, setIsPulsing] = useState(false)

  useEffect(() => {
    if (state === "processing") {
      setIsPulsing(true)
    } else {
      setIsPulsing(false)
    }
  }, [state])

  const stateStyles = {
    idle: "",
    processing: cn(
      "animate-pulse",
      "border-[2px] border-transparent",
      "bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 bg-clip-border",
      "shadow-lg shadow-purple-500/20"
    ),
    success: cn(
      "border-green-500 bg-green-500/10",
      "animate-pulse",
      "shadow-lg shadow-green-500/20"
    ),
    error: cn(
      "border-red-500 bg-red-500/10",
      "animate-pulse",
      "shadow-lg shadow-red-500/20"
    ),
    warning: cn(
      "border-orange-500 bg-orange-500/10", 
      "animate-pulse",
      "shadow-lg shadow-orange-500/20"
    ),
  }

  const getAnimationClass = () => {
    switch (state) {
      case "processing":
        return "animate-spin"
      case "error":
        return "animate-bounce"
      case "success":
        return "animate-pulse"
      case "warning":
        return "animate-pulse"
      default:
        return ""
    }
  }

  // 如果指定了目标元素，在其周围显示效果
  if (targetElement) {
    useEffect(() => {
      const element = targetElement
      
      // 清除之前的状态类
      Object.values(stateStyles).forEach(style => {
        style.split(" ").forEach(cls => {
          if (cls && cls.trim()) {
            element.classList.remove(cls.trim())
          }
        })
      })

      // 添加当前状态类
      if (state !== "idle") {
        stateStyles[state].split(" ").forEach(cls => {
          if (cls && cls.trim()) {
            element.classList.add(cls.trim())
          }
        })
      }

      return () => {
        // 清理所有状态类
        Object.values(stateStyles).forEach(style => {
          style.split(" ").forEach(cls => {
            if (cls && cls.trim()) {
              element.classList.remove(cls.trim())
            }
          })
        })
      }
    }, [state, targetElement])

    return null
  }

  // 默认：渲染独立的环境指示器
  return (
    <div 
      className={cn(
        "fixed top-4 right-4 z-50",
        "px-4 py-2 rounded-full",
        "backdrop-blur-xl border border-white/20",
        "transition-all duration-300 ease-in-out",
        stateStyles[state],
        className
      )}
    >
      <div className="flex items-center gap-2">
        {/* 状态图标 */}
        <div className={cn("w-2 h-2 rounded-full", getAnimationClass())}>
          {state === "processing" && (
            <div className="w-full h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" />
          )}
          {state === "success" && (
            <div className="w-full h-full bg-green-500 rounded-full" />
          )}
          {state === "error" && (
            <div className="w-full h-full bg-red-500 rounded-full" />
          )}
          {state === "warning" && (
            <div className="w-full h-full bg-orange-500 rounded-full" />
          )}
        </div>
        
        {/* 状态文字 */}
        {message && (
          <span className="text-xs font-medium text-white/80">
            {message}
          </span>
        )}
      </div>
    </div>
  )
}

// Hook for managing ambient state
export function useAmbientIndicator(targetElementId?: string) {
  const [state, setState] = useState<AmbientState>("idle")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    if (targetElementId) {
      const element = document.getElementById(targetElementId)
      if (!element) {
        console.warn(`Element with id "${targetElementId}" not found`)
      }
    }
  }, [targetElementId])

  const setProcessing = (msg?: string) => {
    setState("processing")
    setMessage(msg || "")
  }

  const setSuccess = (msg?: string) => {
    setState("success")
    setMessage(msg || "")
    setTimeout(() => setState("idle"), 2000)
  }

  const setError = (msg?: string) => {
    setState("error")
    setMessage(msg || "")
    setTimeout(() => setState("idle"), 3000)
  }

  const setWarning = (msg?: string) => {
    setState("warning") 
    setMessage(msg || "")
    setTimeout(() => setState("idle"), 2500)
  }

  const setIdle = () => {
    setState("idle")
    setMessage("")
  }

  return {
    state,
    message,
    setProcessing,
    setSuccess,
    setError,
    setWarning,
    setIdle,
  }
}

// 特定场景的环境光效果组件
export function ProcessingBorder({ 
  isActive, 
  children 
}: { 
  isActive: boolean
  children: React.ReactNode 
}) {
  return (
    <div className={cn(
      "relative rounded-lg transition-all duration-300",
      isActive && [
        "p-[2px]",
        "bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500",
        "animate-pulse",
        "shadow-lg"
      ]
    )}>
      <div className={cn(
        "bg-background rounded-lg",
        isActive && "opacity-90"
      )}>
        {children}
      </div>
    </div>
  )
}
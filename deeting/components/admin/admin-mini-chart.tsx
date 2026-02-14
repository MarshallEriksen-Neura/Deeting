"use client"

import { cn } from "@/lib/utils"

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "var(--primary)",
  className,
}: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height - 4) - 2
      return `${x},${y}`
    })
    .join(" ")

  const areaPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient
          id={`sparkline-grad-${color.replace(/[^a-z0-9]/gi, "")}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={areaPoints}
        fill={`url(#sparkline-grad-${color.replace(/[^a-z0-9]/gi, "")})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface DonutChartProps {
  value: number
  total: number
  size?: number
  strokeWidth?: number
  color?: string
  label?: string
  className?: string
}

export function DonutChart({
  value,
  total,
  size = 64,
  strokeWidth = 6,
  color = "var(--primary)",
  label,
  className,
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const percentage = total > 0 ? value / total : 0
  const offset = circumference * (1 - percentage)

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-white/5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      {label && (
        <span className="absolute text-xs font-semibold text-[var(--foreground)]">
          {label}
        </span>
      )}
    </div>
  )
}

interface BarChartMiniProps {
  data: { label: string; value: number; color?: string }[]
  height?: number
  className?: string
}

export function BarChartMini({
  data,
  height = 120,
  className,
}: BarChartMiniProps) {
  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className={cn("flex items-end gap-2", className)} style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] font-medium text-[var(--muted)]">
            {d.value}
          </span>
          <div
            className="w-full rounded-t-md transition-all duration-300"
            style={{
              height: `${(d.value / max) * (height - 32)}px`,
              backgroundColor: d.color ?? "var(--primary)",
              minHeight: 4,
              opacity: 0.8,
            }}
          />
          <span className="text-[9px] text-[var(--muted)] truncate w-full text-center">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  )
}

"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface KeyIdenticonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The key ID to generate identicon from */
  keyId: string
  /** Size of the identicon */
  size?: "sm" | "default" | "lg"
}

/**
 * KeyIdenticon - Generates a deterministic geometric pattern based on key ID
 *
 * Creates a unique visual fingerprint for each API key using the key's ID hash.
 * Inspired by GitHub identicons but with a more geometric, cyber aesthetic.
 */
export function KeyIdenticon({ keyId, size = "default", className, ...props }: KeyIdenticonProps) {
  const sizeClasses = {
    sm: "size-8",
    default: "size-10",
    lg: "size-12",
  }

  // Generate deterministic values from keyId
  const hash = React.useMemo(() => {
    let h = 0
    for (let i = 0; i < keyId.length; i++) {
      h = keyId.charCodeAt(i) + ((h << 5) - h)
      h = h & h
    }
    return Math.abs(h)
  }, [keyId])

  const hue = hash % 360
  const pattern = (hash >> 8) % 4
  const rotation = (hash >> 12) % 4 * 90

  const renderPattern = () => {
    const primaryColor = `hsl(${hue}, 70%, 60%)`
    const secondaryColor = `hsl(${(hue + 40) % 360}, 60%, 50%)`

    switch (pattern) {
      case 0: // Concentric rings
        return (
          <>
            <circle cx="16" cy="16" r="12" fill="none" stroke={primaryColor} strokeWidth="2" opacity="0.3" />
            <circle cx="16" cy="16" r="8" fill="none" stroke={primaryColor} strokeWidth="2" opacity="0.5" />
            <circle cx="16" cy="16" r="4" fill={primaryColor} />
          </>
        )
      case 1: // Diamond
        return (
          <>
            <rect x="8" y="8" width="16" height="16" fill={primaryColor} opacity="0.3" transform={`rotate(45, 16, 16)`} />
            <rect x="10" y="10" width="12" height="12" fill={secondaryColor} opacity="0.5" transform={`rotate(45, 16, 16)`} />
            <rect x="12" y="12" width="8" height="8" fill={primaryColor} transform={`rotate(45, 16, 16)`} />
          </>
        )
      case 2: // Hexagon
        return (
          <>
            <polygon
              points="16,4 26,10 26,22 16,28 6,22 6,10"
              fill={primaryColor}
              opacity="0.3"
            />
            <polygon
              points="16,8 22,12 22,20 16,24 10,20 10,12"
              fill={secondaryColor}
              opacity="0.6"
            />
            <circle cx="16" cy="16" r="3" fill={primaryColor} />
          </>
        )
      case 3: // Grid pattern
      default:
        return (
          <>
            <rect x="4" y="4" width="8" height="8" rx="2" fill={primaryColor} opacity={(hash >> 16) % 2 ? 0.8 : 0.3} />
            <rect x="20" y="4" width="8" height="8" rx="2" fill={secondaryColor} opacity={(hash >> 17) % 2 ? 0.8 : 0.3} />
            <rect x="4" y="20" width="8" height="8" rx="2" fill={secondaryColor} opacity={(hash >> 18) % 2 ? 0.8 : 0.3} />
            <rect x="20" y="20" width="8" height="8" rx="2" fill={primaryColor} opacity={(hash >> 19) % 2 ? 0.8 : 0.3} />
            <rect x="12" y="12" width="8" height="8" rx="2" fill={primaryColor} />
          </>
        )
    }
  }

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-xl",
        "bg-[var(--surface)]/50 backdrop-blur-sm",
        "border border-white/10",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <svg
        viewBox="0 0 32 32"
        className="size-full"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {renderPattern()}
      </svg>
    </div>
  )
}

export default KeyIdenticon

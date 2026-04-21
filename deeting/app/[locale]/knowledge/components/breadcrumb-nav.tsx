"use client"

import React from "react"
import { useTranslations } from "next-intl"
import { ChevronRight, Home } from "lucide-react"
import { cn } from "@/lib/utils"

interface BreadcrumbNavProps {
  path: { id: string | null; name: string }[]
  onNavigate: (folderId: string | null) => void
}

const BreadcrumbNav = React.memo(({ path, onNavigate }: BreadcrumbNavProps) => {
  const t = useTranslations("knowledge")

  return (
    <div className="flex items-center gap-1">
      {/* Root item */}
      <button
        onClick={() => onNavigate(null)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 text-sm transition-colors",
          path.length === 0
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
        )}
      >
        <Home className="h-4 w-4" />
        <span>{t("breadcrumb.root")}</span>
      </button>

      {/* Path items */}
      {path.map((item, index) => {
        const isLast = index === path.length - 1

        return (
          <React.Fragment key={item.id || `root-${index}`}>
            {/* Separator */}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />

            {/* Path item */}
            <button
              onClick={() => !isLast && onNavigate(item.id || null)}
              className={cn(
                "px-2 py-1 text-sm transition-colors",
                isLast
                  ? "text-foreground font-medium cursor-default"
                  : "text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
              )}
            >
              {item.name}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
})

BreadcrumbNav.displayName = "BreadcrumbNav"

export { BreadcrumbNav }

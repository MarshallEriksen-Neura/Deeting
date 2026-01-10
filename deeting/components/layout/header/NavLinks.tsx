"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"
import { NavItem } from "./types"

interface NavLinksProps {
  items: NavItem[]
}

export function NavLinks({ items }: NavLinksProps) {
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "relative px-3 py-1.5 text-sm font-medium transition-all duration-200",
            "text-[var(--muted)] hover:text-[var(--foreground)]",
            item.isActive && [
              "text-[var(--foreground)]",
              "after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-4/5 after:-translate-x-1/2",
              "after:rounded-full after:bg-[var(--primary)]",
              "after:shadow-[0_0_8px_var(--primary)]",
            ]
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}


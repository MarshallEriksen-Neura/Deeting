"use client"

import * as React from "react"

import { GlassSidebarProvider } from "@/components/layout/sidebar"

interface DashboardLayoutClientProps {
  role?: "admin" | "user"
  children: React.ReactNode
}

export function DashboardLayoutClient({
  role = "user",
  children,
}: DashboardLayoutClientProps) {
  return (
    <div
      className="bg-[var(--background)]"
      style={{
        minHeight:
          "calc(var(--app-viewport-height, 100dvh) - var(--app-header-offset, 5rem))",
      }}
    >
      {/* Secondary Navigation - Sidebar/Horizontal Nav */}
      <GlassSidebarProvider role={role}>
        {children}
      </GlassSidebarProvider>
    </div>
  )
}

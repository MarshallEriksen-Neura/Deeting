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
    <div className="min-h-screen bg-[var(--background)]">
      {/* Secondary Navigation - Sidebar/Horizontal Nav */}
      <GlassSidebarProvider role={role}>
        {children}
      </GlassSidebarProvider>
    </div>
  )
}

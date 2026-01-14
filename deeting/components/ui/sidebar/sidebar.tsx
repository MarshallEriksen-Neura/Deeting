"use client"

import * as React from "react"
import { useSidebar } from "./sidebar-context"
import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import { PanelLeft, PanelLeftClose } from "lucide-react"

// Constants
const HEADER_HEIGHT = 56

interface SidebarProps extends React.ComponentProps<"div"> {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      className,
      children,
      ...props
    },
    ref
  ) => {
    const { isMobile, state } = useSidebar()

    if (collapsible === "none") {
      return (
        <div
          className={cn(
            "flex h-full w-[--sidebar-width] flex-col bg-[var(--card)] text-[var(--foreground)]",
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      )
    }

    if (isMobile) {
      // Mobile Horizontal Bar Implementation
      return (
        <div
          className={cn(
            "sticky z-40 w-full bg-[var(--surface)]/80 backdrop-blur-xl border-b border-[var(--border)]/50 transition-all",
            className
          )}
          style={{
            top: HEADER_HEIGHT,
          }}
          ref={ref}
          {...props}
        >
             {children}
        </div>
      )
    }

    // Desktop Implementation (non-fixed, participates in layout grid/flex)
    return (
      <div
        ref={ref}
        className={cn(
          "group peer hidden md:block text-[var(--foreground)]",
          "relative md:sticky md:top-[56px]", // header height
          "bg-[var(--card)]/60 backdrop-blur-xl border-r border-white/10 shadow-[4px_0_16px_-4px_rgba(0,0,0,0.05)]",
          "transition-[width] duration-300 ease-linear",
          state === "collapsed" ? "w-[--sidebar-width-icon]" : "w-[--sidebar-width]",
          className
        )}
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
        style={{
            height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        }}
      >
        <div className="flex h-full w-full flex-col">
            {children}
        </div>
      </div>
    )
  }
)
Sidebar.displayName = "Sidebar"

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  const { isMobile } = useSidebar()

  return (
    <div
      ref={ref}
      className={cn(
        "flex min-h-0 flex-1 gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        isMobile ? "flex-row items-center px-4 py-2 overflow-x-auto scrollbar-hide" : "flex-col",
        className
      )}
      {...props}
    />
  )
})
SidebarContent.displayName = "SidebarContent"

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-2 p-4 group-data-[collapsible=icon]:p-2", className)}
      {...props}
    />
  )
})
SidebarHeader.displayName = "SidebarHeader"

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  const { isMobile } = useSidebar()

  if (isMobile) {
    return null
  }

  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-2 p-4 group-data-[collapsible=icon]:p-2", className)}
      {...props}
    />
  )
})
SidebarFooter.displayName = "SidebarFooter"

const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof GlassButton>
>(({ className, onClick, children, ...props }, ref) => {
  const { toggleSidebar, state } = useSidebar()

  return (
    <GlassButton
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      {state === "expanded" ? (
         <PanelLeftClose className="size-4 shrink-0" />
      ) : (
         <PanelLeft className="size-4 shrink-0" />
      )}
      {children && <span className="ml-2">{children}</span>}
      <span className="sr-only">Toggle Sidebar</span>
    </GlassButton>
  )
})
SidebarTrigger.displayName = "SidebarTrigger"

export { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarTrigger }

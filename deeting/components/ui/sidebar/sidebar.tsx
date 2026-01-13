"use client"

import * as React from "react"
import { useSidebar } from "./sidebar-context"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
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
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

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
      // Mobile Drawer Implementation
      return (
        <>
           {/* Overlay */}
           {openMobile && (
            <div 
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" 
              onClick={() => setOpenMobile(false)}
            />
          )}
          <div
            className={cn(
              "fixed inset-y-0 z-50 h-full w-[85%] max-w-[300px] flex-col bg-[var(--surface)] shadow-2xl transition-transform duration-300 ease-in-out",
              side === "left" 
                ? "left-0 border-r border-white/10" 
                : "right-0 border-l border-white/10",
              openMobile ? "translate-x-0" : (side === "left" ? "-translate-x-full" : "translate-x-full"),
              className
            )}
            ref={ref}
            {...props}
          >
             {children}
          </div>
        </>
      )
    }

    // Desktop Implementation
    return (
      <div
        ref={ref}
        className={cn(
          "group peer hidden md:block text-[var(--foreground)]",
          "fixed z-30 bg-[var(--card)]/60 backdrop-blur-xl border-r border-white/10 shadow-[4px_0_16px_-4px_rgba(0,0,0,0.05)]",
          "transition-[width] duration-300 ease-linear",
          state === "collapsed" ? "w-[--sidebar-width-icon]" : "w-[--sidebar-width]",
          className
        )}
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
        style={{
            top: HEADER_HEIGHT,
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
  return (
    <div
      ref={ref}
      className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden", className)}
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

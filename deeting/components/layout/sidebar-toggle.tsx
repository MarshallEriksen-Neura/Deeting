"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { IconButton } from "@/components/ui/common/icon-button";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/shadcn/sidebar";

export function SidebarToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const label = isCollapsed ? "展开侧边栏" : "收起侧边栏";

  return (
    <IconButton
      variant="surface"
      size="md"
      label={label}
      onClick={toggleSidebar}
      active={isCollapsed}
      className={cn("shrink-0")}
    >
      {isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
    </IconButton>
  );
}

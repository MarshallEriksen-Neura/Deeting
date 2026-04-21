"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Blocks,
  BrainCircuit,
  ChevronDown,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Search,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/common/icon-button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/shadcn/sidebar";

type SidebarItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

type SidebarGroupConfig = {
  title: string;
  items: SidebarItem[];
};

const NAV_GROUPS: SidebarGroupConfig[] = [
  {
    title: "Workspace",
    items: [
      { id: "overview", label: "总览", icon: LayoutDashboard, badge: "3" },
      { id: "assembly", label: "上下文编排", icon: Blocks, badge: "live" },
      { id: "memory", label: "记忆原语", icon: BrainCircuit, badge: "1.4k" },
      { id: "pipeline", label: "片段管线", icon: Gauge, badge: "6" },
    ],
  },
  {
    title: "Surface",
    items: [
      { id: "surface", label: "工作区视图", icon: Search },
      { id: "inspector", label: "检查器", icon: PanelRight, badge: "pin" },
    ],
  },
];

const SECTION_IDS = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));

function useActiveSection(sectionIds: string[]) {
  const [activeSection, setActiveSection] = React.useState(sectionIds[0] ?? "");

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash && sectionIds.includes(hash)) {
        setActiveSection(hash);
      }
    };

    updateFromHash();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveSection(visible.target.id);
        }
      },
      {
        rootMargin: "-18% 0px -52% 0px",
        threshold: [0.18, 0.36, 0.6],
      }
    );

    sectionIds.forEach((sectionId) => {
      const element = document.getElementById(sectionId);
      if (element) {
        observer.observe(element);
      }
    });

    window.addEventListener("hashchange", updateFromHash);

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, [sectionIds]);

  return [activeSection, setActiveSection] as const;
}

function WorkstationSidebarItem({
  item,
  isActive,
  isCollapsed,
  onSelect,
}: {
  item: SidebarItem;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: (id: string) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const Icon = item.icon;

  return (
    <SidebarMenuItem className="relative list-none">
      <motion.a
        href={`#${item.id}`}
        data-active={isActive}
        className={cn(
          "group/nav relative flex w-full items-center overflow-hidden rounded-[12px] border border-transparent text-[13px] font-medium text-[var(--ink-2)] outline-none focus-visible:shadow-[var(--focus-ring)]",
          "h-8 gap-3 px-3 py-0",
          "transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-decel)]",
          "hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] hover:text-[var(--ink)]",
          "data-[active=true]:text-[var(--accent-ink)]",
          isCollapsed && "h-10 justify-center gap-0 px-0"
        )}
        onClick={(event) => {
          event.preventDefault();
          onSelect(item.id);
        }}
        whileHover={shouldReduceMotion ? undefined : { x: isCollapsed ? 0 : 2 }}
        whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 320, damping: 26, mass: 0.8 }
        }
        title={isCollapsed ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
      >
        {isActive ? (
          <motion.span
            layoutId="workstation-sidebar-active"
            className="absolute inset-0 rounded-[12px] border border-[var(--accent-border)] bg-[var(--accent-soft)]"
            transition={{
              type: "spring",
              stiffness: 280,
              damping: 30,
              mass: 0.9,
            }}
            aria-hidden
          />
        ) : null}

        {isActive ? (
          <motion.span
            layoutId="workstation-sidebar-rail"
            className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-strong)]"
            transition={{
              type: "spring",
              stiffness: 280,
              damping: 32,
              mass: 0.8,
            }}
            aria-hidden
          />
        ) : null}

        <motion.span
          className={cn(
            "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors",
            isCollapsed && "size-10 rounded-[12px]",
            isActive
              ? "bg-[color-mix(in_srgb,var(--accent-soft)_70%,white_24%)] text-[var(--accent-strong)]"
              : "text-[var(--ink-3)] group-hover/nav:text-[var(--ink)]"
          )}
          whileHover={shouldReduceMotion ? undefined : { scale: 1.045, rotate: -3 }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 360, damping: 24 }
          }
        >
          <Icon className={cn(isCollapsed ? "size-5" : "size-[18px]")} />
        </motion.span>

        {!isCollapsed ? (
          <>
            <span className="relative z-[1] flex-1 truncate">{item.label}</span>
            {item.badge ? (
              <span
                className={cn(
                  "relative z-[1] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-mono text-[10px] tabular-nums",
                  isActive
                    ? "bg-[var(--accent-strong)] text-[var(--accent-contrast)]"
                    : "border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]"
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </>
        ) : null}
      </motion.a>
    </SidebarMenuItem>
  );
}

function SidebarFooterCluster({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[14px] border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_92%,transparent)] p-2",
        isCollapsed && "flex-col"
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] font-semibold tracking-[-0.04em] text-[var(--ink)]">
        D
      </div>

      {!isCollapsed ? (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--ink)]">
            Deeting Shell
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-3)]">
            <span className="inline-flex h-2 w-2 rounded-full bg-[var(--ok)]" />
            Ready
          </div>
        </div>
      ) : null}

      <div className={cn("flex items-center gap-1", isCollapsed && "flex-col")}>
        <IconButton variant="ghost" size="sm" label="设置">
          <Settings2 />
        </IconButton>
        <IconButton variant="ghost" size="sm" label="帮助">
          <HelpCircle />
        </IconButton>
      </div>
    </div>
  );
}

export function WorkstationSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(NAV_GROUPS.map((group) => [group.title, true])) as Record<
        string,
        boolean
      >
  );
  const [activeSection, setActiveSection] = useActiveSection(SECTION_IDS);

  const handleSelect = React.useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId);

      if (typeof document !== "undefined") {
        const target = document.getElementById(sectionId);
        target?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      }

      if (typeof history !== "undefined") {
        history.replaceState(null, "", `#${sectionId}`);
      }
    },
    [setActiveSection]
  );

  const CollapseIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  const collapseLabel = isCollapsed ? "展开侧栏" : "收起侧栏";

  return (
    <aside
      data-slot="workstation-sidebar"
      data-state={state}
      data-collapsible={isCollapsed ? "icon" : "expanded"}
      className={cn(
        "group/sidebar group relative flex h-full min-h-0 flex-col border-r border-[var(--hairline)]",
        "bg-[linear-gradient(177deg,color-mix(in_srgb,var(--sidebar-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--sidebar-bg)_90%,transparent)_78%,color-mix(in_srgb,var(--sidebar-bg)_82%,var(--window-bg)_18%)_100%)]",
        "backdrop-blur-[32px] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)]",
        isCollapsed ? "w-[68px]" : "w-[264px]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.38),transparent_24%)] opacity-70 dark:opacity-40" />

      <SidebarHeader className={cn("relative z-[1] gap-3 p-3", isCollapsed && "px-2 py-3")}>
        <div
          className={cn(
            "flex items-center gap-2",
            isCollapsed ? "flex-col" : "flex-row"
          )}
        >
          <button
            type="button"
            onClick={() => handleSelect("overview")}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-[14px] border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_92%,transparent)] p-2 text-left transition-[border-color,transform] duration-[var(--dur-medium)] ease-[var(--ease-standard)] hover:border-[var(--hairline-strong)] hover:-translate-y-px",
              isCollapsed && "w-full flex-none justify-center p-1.5"
            )}
            aria-label="Go to workspace overview"
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]",
                isCollapsed && "size-10 rounded-[12px]"
              )}
            >
              <div className="grid grid-cols-2 gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-3)]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-strong)]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-3)]" />
              </div>
            </div>
            {!isCollapsed ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                  Deeting
                </div>
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.2em] text-[var(--ink-3)]">
                  Workstation
                </div>
              </div>
            ) : null}
            {!isCollapsed ? (
              <ChevronDown className="size-3.5 shrink-0 text-[var(--ink-3)]" />
            ) : null}
          </button>

          <IconButton
            variant="surface"
            size="md"
            label={collapseLabel}
            onClick={toggleSidebar}
            className={cn("shrink-0", isCollapsed && "w-full")}
          >
            <CollapseIcon />
          </IconButton>
        </div>
      </SidebarHeader>

      <SidebarContent
        className={cn(
          "relative z-[1] min-h-0 flex-1 overflow-y-auto px-2 pb-3",
          isCollapsed && "px-1.5"
        )}
      >
        {NAV_GROUPS.map((group) => {
          const isExpanded = expandedGroups[group.title] ?? true;
          return (
            <SidebarGroup
              key={group.title}
              className={cn("gap-1 px-1 py-1.5", isCollapsed && "px-0 py-1")}
            >
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [group.title]: !isExpanded,
                    }))
                  }
                  className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:text-[var(--ink-2)]"
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform duration-[var(--dur-medium)] ease-[var(--ease-standard)]",
                      !isExpanded && "-rotate-90"
                    )}
                  />
                  <SidebarGroupLabel className="h-auto p-0 text-inherit">
                    {group.title}
                  </SidebarGroupLabel>
                </button>
              ) : (
                <div className="mx-auto my-2 h-px w-7 rounded-full bg-[var(--hairline)]" />
              )}

              {isExpanded ? (
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1">
                    {group.items.map((item) => (
                      <WorkstationSidebarItem
                        key={item.id}
                        item={item}
                        isCollapsed={isCollapsed}
                        isActive={activeSection === item.id}
                        onSelect={handleSelect}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              ) : null}
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className={cn("relative z-[1] p-3 pt-2", isCollapsed && "p-2")}>
        <SidebarFooterCluster isCollapsed={isCollapsed} />
      </SidebarFooter>
    </aside>
  );
}

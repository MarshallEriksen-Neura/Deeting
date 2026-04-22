"use client";

import * as React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Activity,
  Bell,
  BookOpen,
  ChevronDown,
  Cpu,
  FileSearch,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Shield,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { useUserProfile } from "@/hooks/use-user";
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

type NavItem = {
  id: string;
  href?: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  adminOnly?: boolean;
};

type NavGroup = {
  id: string;
  titleKey:
    | "nav.workspace"
    | "nav.modelsAndAgents"
    | "nav.automationAndObservability"
    | "nav.knowledgeAndStorage"
    | "nav.admin";
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    titleKey: "nav.workspace",
    items: [
      { id: "chat", href: "/chat", labelKey: "nav.chat", icon: MessageSquare },
      { id: "overview", href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { id: "mcp", href: "/mcp", labelKey: "nav.mcp", icon: Terminal },
      { id: "skills", href: "/skills", labelKey: "nav.skills", icon: Workflow },
    ],
  },
  {
    id: "models-and-agents",
    titleKey: "nav.modelsAndAgents",
    items: [
      { id: "providers", href: "/models/providers", labelKey: "nav.providers", icon: Cpu },
      { id: "provider-market", href: "/models/market", labelKey: "nav.providerMarket", icon: Cpu },
      { id: "model-pools", href: "/models/pools", labelKey: "nav.modelPools", icon: Activity },
      { id: "task-agents", href: "/agents/task-agents", labelKey: "nav.taskAgents", icon: Workflow },
    ],
  },
  {
    id: "automation-and-observability",
    titleKey: "nav.automationAndObservability",
    items: [
      { id: "security-policy", href: "/dashboard/approval-rules", labelKey: "nav.securityPolicy", icon: Shield },
      { id: "monitors", href: "/dashboard/monitors", labelKey: "nav.monitors", icon: Activity },
      { id: "notification-channels", href: "/dashboard/notification-channels", labelKey: "nav.notificationChannels", icon: Bell },
      { id: "monitoring", href: "/dashboard/monitoring", labelKey: "nav.monitoring", icon: Gauge },
      { id: "bandit", href: "/dashboard/bandit", labelKey: "nav.bandit", icon: Activity },
      { id: "task-learning", href: "/dashboard/task-learning", labelKey: "nav.taskLearning", icon: Activity },
      { id: "logs", href: "/dashboard/logs", labelKey: "nav.logs", icon: Activity },
    ],
  },
  {
    id: "knowledge-and-storage",
    titleKey: "nav.knowledgeAndStorage",
    items: [
      { id: "knowledge", href: "/knowledge", labelKey: "nav.knowledge", icon: FolderOpen },
      { id: "llm-wiki", href: "/llm-wiki", labelKey: "nav.llmWiki", icon: FolderOpen },
      { id: "memory", href: "/memory", labelKey: "nav.memory", icon: FolderOpen },
      { id: "scan-reviews", href: "/scan-reviews", labelKey: "nav.scanReviews", icon: FileSearch },
    ],
  },
  {
    id: "admin",
    titleKey: "nav.admin",
    items: [
      { id: "admin-provider-presets", href: "/admin/provider-presets", labelKey: "nav.providerPresets", icon: KeyRound, adminOnly: true },
      { id: "admin-users", href: "/admin/users", labelKey: "nav.userManagement", icon: Users, adminOnly: true },
    ],
  },];

const FOOTER_ACTIONS: Required<Pick<NavItem, "id" | "href" | "labelKey" | "icon">>[] = [
  { id: "docs", href: "/", labelKey: "docs", icon: BookOpen },
  { id: "settings", href: "/settings", labelKey: "nav.settings", icon: Settings },
];

function isLeafActive(pathname: string, href?: string) {
  if (!href) {
    return false;
  }

  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function isNavItemActive(pathname: string, item: NavItem) {
  return item.href ? isLeafActive(pathname, item.href) : false;
}

function SidebarChrome({
  isActive,
  isCollapsed,
  icon: Icon,
  label,
  trailing,
}: {
  isActive: boolean;
  isCollapsed: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <>
      {isActive ? (
        <motion.span
          layoutId="workstation-sidebar-active"
          className="absolute inset-0 rounded-[12px] border border-[var(--accent-border)] bg-[var(--accent-soft)]"
          transition={{ type: "spring", stiffness: 280, damping: 30, mass: 0.9 }}
          aria-hidden
        />
      ) : null}
      {isActive ? (
        <motion.span
          layoutId="workstation-sidebar-rail"
          className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-strong)]"
          transition={{ type: "spring", stiffness: 280, damping: 32, mass: 0.8 }}
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors",
          isCollapsed && "size-10 rounded-[12px]",
          isActive
            ? "bg-[color-mix(in_srgb,var(--accent-soft)_70%,white_24%)] text-[var(--accent-strong)]"
            : "text-[var(--ink-3)] group-hover/nav:text-[var(--ink)]"
        )}
      >
        <Icon className={cn(isCollapsed ? "size-5" : "size-[18px]")} />
      </span>
      {!isCollapsed ? <span className="relative z-[1] flex-1 truncate">{label}</span> : null}
      {!isCollapsed ? trailing : null}
    </>
  );
}

function WorkstationSidebarLinkItem({
  item,
  isActive,
  isCollapsed,
  label,
  unavailableLabel,
}: {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  label: string;
  unavailableLabel: string;
}) {
  const Icon = item.icon;
  const href = item.href;
  const isDisabled = item.disabled || !href;
  const className = cn(
    "group/nav relative flex w-full items-center overflow-hidden rounded-[12px] border border-transparent text-[13px] font-medium text-[var(--ink-2)] outline-none",
    "h-8 gap-3 px-3 py-0 transition-[background-color,border-color,color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-decel)]",
    !isDisabled &&
      "hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] hover:text-[var(--ink)] focus-visible:shadow-[var(--focus-ring)]",
    isDisabled && "cursor-default text-[var(--ink-3)] opacity-72",
    "data-[active=true]:text-[var(--accent-ink)]",
    isCollapsed && "h-10 justify-center gap-0 px-0"
  );
  const content = (
    <>
      <SidebarChrome isActive={isActive} isCollapsed={isCollapsed} icon={Icon} label={label} />
      {!isCollapsed && isDisabled ? (
        <span className="relative z-[1] shrink-0 rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-3)]">
          {unavailableLabel}
        </span>
      ) : null}
    </>
  );

  return (
    <SidebarMenuItem className="relative list-none">
      {isDisabled ? (
        <div className={className} title={isCollapsed ? `${label} - ${unavailableLabel}` : undefined} aria-disabled="true">
          {content}
        </div>
      ) : (
        <Link
          href={href}
          data-active={isActive}
          className={className}
          title={isCollapsed ? label : undefined}
          aria-current={isActive ? "page" : undefined}
        >
          {content}
        </Link>
      )}
    </SidebarMenuItem>
  );
}

function SidebarFooterCluster({ isCollapsed }: { isCollapsed: boolean }) {
  const tCommon = useTranslations("common");

  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-2 py-1",
        isCollapsed && "items-center"
      )}
    >
      {FOOTER_ACTIONS.map((item) => {
        const Icon = item.icon;
        const label = tCommon(item.labelKey as never);

        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "flex h-9 w-full items-center rounded-[12px] text-[15px] font-medium text-[var(--ink-2)] outline-none transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] hover:text-[var(--ink)] focus-visible:shadow-[var(--focus-ring)]",
              isCollapsed ? "justify-center px-0" : "gap-4 px-2"
            )}
            title={isCollapsed ? label : undefined}
          >
            <Icon className="size-5 shrink-0 text-[var(--ink-3)]" />
            {!isCollapsed ? <span className="truncate">{label}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export function WorkstationSidebar() {
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const unavailableLabel = tCommon("nav.planned");
  const { profile } = useUserProfile();
  const isAdmin = Boolean(profile?.is_superuser);
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({
    workspace: true,
    "models-and-agents": true,
    "automation-and-observability": true,
    "knowledge-and-storage": true,
    admin: true,
  });

  return (
    <aside
      data-slot="workstation-sidebar"
      data-state={state}
      data-collapsible={isCollapsed ? "icon" : "expanded"}
      className={cn(
        "group/sidebar group relative flex h-full min-h-0 flex-col",
        "bg-[linear-gradient(177deg,color-mix(in_srgb,var(--sidebar-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--sidebar-bg)_90%,transparent)_78%,color-mix(in_srgb,var(--sidebar-bg)_82%,var(--window-bg)_18%)_100%)]",
        "shadow-[2px_0_10px_-8px_color-mix(in_srgb,var(--ink)_22%,transparent)]",
        "after:pointer-events-none after:absolute after:inset-y-0 after:-right-2 after:w-2 after:content-[''] after:bg-[linear-gradient(90deg,color-mix(in_srgb,var(--ink)_4%,transparent),transparent)]",
        "backdrop-blur-[32px] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)]",
        isCollapsed ? "w-[68px]" : "w-[264px]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.38),transparent_24%)] opacity-70 dark:opacity-40" />
      <SidebarHeader className={cn("relative z-[1] gap-3 p-3", isCollapsed && "px-2 py-3")}>
        <Link
          href="/"
          className={cn(
            "group/brand relative flex min-w-0 items-center gap-3 overflow-hidden rounded-[16px] px-2.5 py-2 text-left transition-transform duration-[var(--dur-medium)] ease-[var(--ease-standard)] hover:-translate-y-px",
            isCollapsed && "w-full justify-center rounded-[14px] px-1.5 py-1.5"
          )}
          aria-label={tCommon("brand")}
        >
          <div
            className={cn(
              "relative z-[1] flex size-10 shrink-0 items-center justify-center rounded-[13px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-1 shadow-[0_2px_8px_-6px_rgba(0,0,0,0.55)]",
              isCollapsed && "size-9 rounded-[12px] p-0.5"
            )}
          >
            <Image src="/web-app-manifest-192x192.png" alt="" width={36} height={36} className="size-full rounded-[10px] object-cover" />
          </div>
          {!isCollapsed ? (
            <div className="relative z-[1] min-w-0 flex-1">
              <div className="relative inline-flex max-w-full">
                <div className="truncate text-[18px] font-semibold leading-none tracking-[-0.025em] text-[var(--ink)]">
                  {tCommon("brand")}
                </div>
                <span className="pointer-events-none absolute -right-5 -top-1 shrink-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">
                  TM
                </span>
              </div>
            </div>
          ) : null}
        </Link>
      </SidebarHeader>
      <SidebarContent className={cn("relative z-[1] min-h-0 flex-1 overflow-y-auto px-2 pb-3", isCollapsed && "px-1.5")}>
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.adminOnly || isAdmin);
          if (visibleItems.length === 0) {
            return null;
          }
          const isExpanded = expandedGroups[group.id] ?? true;

          return (
            <SidebarGroup key={group.id} className={cn("gap-1 px-1 py-1.5", isCollapsed && "px-0 py-1")}>
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() => setExpandedGroups((current) => ({ ...current, [group.id]: !isExpanded }))}
                  className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:text-[var(--ink-2)]"
                >
                  <ChevronDown className={cn("size-3 transition-transform duration-[var(--dur-medium)] ease-[var(--ease-standard)]", !isExpanded && "-rotate-90")} />
                  <SidebarGroupLabel className="h-auto p-0 text-inherit">{tCommon(group.titleKey)}</SidebarGroupLabel>
                </button>
              ) : (
                <div className="mx-auto my-2 h-px w-7 rounded-full bg-[var(--hairline)]" />
              )}
              {isExpanded ? (
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1">
                    {visibleItems.map((item) => {
                      const isActive = isNavItemActive(pathname, item);
                      const label = tCommon(item.labelKey as never);

                      return (
                        <WorkstationSidebarLinkItem
                          key={item.id}
                          item={item}
                          isActive={isActive}
                          isCollapsed={isCollapsed}
                          label={label}
                          unavailableLabel={unavailableLabel}
                        />
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              ) : null}
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className={cn("relative z-[1] p-3 pt-2", isCollapsed && "px-2")}>
        <SidebarFooterCluster isCollapsed={isCollapsed} />
      </SidebarFooter>
    </aside>
  );
}



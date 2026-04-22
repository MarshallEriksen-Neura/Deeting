'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Home, LayoutDashboard, ShoppingBag, Settings, Sun, Moon, LogIn, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { Link } from '@/i18n/routing';
import { isTauriRuntime as detectTauriRuntime } from '@/lib/runtime/tauri';

interface HudSystemMenuPanelProps {
  homeLabel: string;
  dashboardLabel: string;
  registryLabel: string;
  preferencesLabel: string;
  interfaceModeLabel: string;
  authActionLabel: string;
  authActionTone: 'default' | 'danger';
  authActionPending?: boolean;
  theme: string | undefined;
  onThemeToggle: () => void;
  onAuthAction: () => void;
}

export function HudSystemMenuPanel({
  homeLabel,
  dashboardLabel,
  registryLabel,
  preferencesLabel,
  interfaceModeLabel,
  authActionLabel,
  authActionTone,
  authActionPending = false,
  theme,
  onThemeToggle,
  onAuthAction,
}: HudSystemMenuPanelProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <MenuLink href="/" icon={<Home className="w-4 h-4" />} label={homeLabel} />
        <MenuLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label={dashboardLabel} />
        <MenuLink href="/market" icon={<ShoppingBag className="w-4 h-4" />} label={registryLabel} />
        <MenuLink href="/settings" icon={<Settings className="w-4 h-4" />} label={preferencesLabel} />
      </div>

      <div className="flex flex-col gap-1 mt-1">
        <Button
          variant="ghost"
          onClick={onThemeToggle}
          className="flex items-center justify-between p-3 rounded-2xl bg-white/70 dark:bg-white/5 hover:bg-white/90 dark:hover:bg-white/10 transition-colors text-[11px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        >
          <div className="flex items-center gap-3">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{interfaceModeLabel}</span>
          </div>
          <span className="text-[9px] opacity-40 uppercase">{theme}</span>
        </Button>

        <button
          type="button"
          onClick={onAuthAction}
          disabled={authActionPending}
          className={[
            "flex items-center gap-3 p-3 rounded-2xl transition-colors text-[11px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] disabled:opacity-60 disabled:pointer-events-none",
            authActionTone === 'danger'
              ? 'bg-white/60 dark:bg-white/5 hover:bg-red-500/10 hover:text-red-500'
              : 'bg-white/60 dark:bg-white/5 hover:bg-white/90 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white',
          ].join(' ')}
        >
          {authActionPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : authActionTone === 'danger' ? (
            <LogOut className="w-4 h-4" />
          ) : (
            <LogIn className="w-4 h-4" />
          )}
          <span>{authActionLabel}</span>
        </button>
      </div>
    </>
  );
}

type AppLinkHref = ComponentProps<typeof Link>['href'];

function MenuLink({ href, icon, label }: { href: AppLinkHref; icon: ReactNode; label: string }) {
  const isTauriRuntime = detectTauriRuntime()
  const className =
    "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/70 dark:bg-white/5 hover:bg-white/90 dark:hover:bg-white/10 transition-all group shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"

  const content = (
    <>
      <div className="text-slate-500/90 dark:text-white/45 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
        {icon}
      </div>
      <span className="text-[9px] font-semibold text-slate-500/90 dark:text-white/40 uppercase tracking-[0.08em] group-hover:text-slate-700 dark:group-hover:text-white/80">
        {label}
      </span>
    </>
  )

  if (isTauriRuntime) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    )
  }

  return (
    <Link
      href={href}
      className={className}
    >
      {content}
    </Link>
  );
}

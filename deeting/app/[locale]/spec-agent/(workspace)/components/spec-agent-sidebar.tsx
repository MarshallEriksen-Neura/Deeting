'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { usePathname } from 'next/navigation'
import {
  Bot,
  MessageSquare,
  Sparkles,
  ShoppingBag,
  LayoutDashboard,
  Cpu,
  UserCircle,
  Settings,
  type LucideIcon
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/use-i18n'
import { useUserProfile } from '@/hooks/use-user'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type SpecAgentNavItem = {
  id: string
  label: string
  href: string
  icon: LucideIcon
}

export function SpecAgentSidebar() {
  const t = useI18n('spec-agent')
  const { profile, isAuthenticated } = useUserProfile()
  const pathname = usePathname()
  const locale = useLocale()

  const localePrefix = locale === 'zh-CN' ? '' : `/${locale}`
  const normalizedPath = useMemo(() => {
    if (!pathname) return '/'
    if (localePrefix && pathname.startsWith(localePrefix)) {
      const trimmed = pathname.slice(localePrefix.length)
      return trimmed === '' ? '/' : trimmed
    }
    return pathname
  }, [localePrefix, pathname])

  const buildHref = (href: string) => {
    if (!localePrefix) return href
    if (href === '/') return localePrefix || '/'
    return `${localePrefix}${href}`
  }

  const mainItems: SpecAgentNavItem[] = [
    {
      id: 'spec-agent',
      label: t('nav.specAgent'),
      href: '/spec-agent',
      icon: Bot,
    },
    {
      id: 'chat',
      label: t('nav.chat'),
      href: '/chat',
      icon: MessageSquare,
    },
    {
      id: 'assistants',
      label: t('nav.assistants'),
      href: '/assistants',
      icon: Sparkles,
    },
    {
      id: 'market',
      label: t('nav.market'),
      href: '/market',
      icon: ShoppingBag,
    },
    {
      id: 'dashboard',
      label: t('nav.dashboard'),
      href: '/dashboard',
      icon: LayoutDashboard,
    },
    {
      id: 'mcp',
      label: t('nav.mcp'),
      href: '/mcp',
      icon: Cpu,
    },
  ]

  const secondaryItems: SpecAgentNavItem[] = [
    {
      id: 'profile',
      label: t('nav.profile'),
      href: '/profile',
      icon: UserCircle,
    },
    {
      id: 'settings',
      label: t('nav.settings'),
      href: '/settings',
      icon: Settings,
    },
  ]

  const isActive = (href: string) =>
    normalizedPath === href || normalizedPath.startsWith(`${href}/`)

  const displayName = useMemo(() => {
    if (profile?.username?.trim()) return profile.username
    if (profile?.email?.trim()) return profile.email
    return t('nav.profile')
  }, [profile?.email, profile?.username, t])

  const avatarSeed = useMemo(() => {
    if (profile?.email?.trim()) return profile.email
    if (profile?.username?.trim()) return profile.username
    return displayName
  }, [displayName, profile?.email, profile?.username])

  const avatarSrc = useMemo(() => {
    if (!isAuthenticated) return undefined
    const realAvatar = profile?.avatar_url?.trim()
    if (realAvatar) return realAvatar
    if (!avatarSeed) return undefined
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(avatarSeed)}`
  }, [avatarSeed, isAuthenticated, profile?.avatar_url])

  const renderItem = (item: SpecAgentNavItem) => {
    const active = isActive(item.href)
    const Icon = item.icon
    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label={item.label}
            className={cn(
              'relative size-11 rounded-2xl transition-all',
              'text-muted-foreground hover:text-foreground hover:bg-muted/40 dark:hover:bg-white/10',
              'focus-visible:ring-2 focus-visible:ring-primary/30',
              active &&
                'bg-primary/15 text-primary shadow-[0_8px_24px_-12px_rgba(59,130,246,0.6)]'
            )}
          >
            <Link href={buildHref(item.href)} aria-current={active ? 'page' : undefined}>
              {active && (
                <span
                  className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                  aria-hidden
                />
              )}
              <Icon className="size-[18px]" />
              <span className="sr-only">{item.label}</span>
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <aside className="w-[76px] flex-shrink-0 border-r border-border bg-card/90 text-foreground shadow-[4px_0_24px_-16px_rgba(15,23,42,0.3)] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.86))] dark:text-white dark:shadow-[4px_0_24px_-16px_rgba(15,23,42,0.6)]">
      <TooltipProvider delayDuration={0}>
        <div className="flex h-full flex-col items-center gap-4 px-2 py-4">
          <div className="flex flex-col items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="secondary"
                  size="icon"
                  aria-label={t('nav.profile')}
                  className={cn(
                    'size-11 rounded-2xl border border-border/60 bg-muted/30 text-foreground shadow-[0_10px_30px_-18px_rgba(15,23,42,0.3)]',
                    'dark:border-white/10 dark:bg-white/10 dark:text-white dark:shadow-[0_10px_30px_-18px_rgba(15,23,42,0.8)]',
                    isActive('/profile') &&
                      'ring-2 ring-primary/30 shadow-[0_0_18px_-6px_rgba(59,130,246,0.6)]'
                  )}
                >
                  <Link href={buildHref('/profile')}>
                    <Avatar className="size-9 border border-border/60 shadow-sm dark:border-white/10">
                      <AvatarImage src={avatarSrc} alt={displayName} />
                      <AvatarFallback className="text-xs font-semibold text-muted-foreground">
                        {displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="sr-only">{t('nav.profile')}</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {t('nav.profile')}
              </TooltipContent>
            </Tooltip>
            <Separator className="w-10 bg-border/60 dark:bg-white/10" />
          </div>

          <div className="flex w-full flex-1 flex-col items-center gap-3">
            {mainItems.map(renderItem)}
          </div>

          <div className="flex flex-col items-center gap-3 pb-2">
            <Separator className="w-10 bg-border/60 dark:bg-white/10" />
            {secondaryItems.map(renderItem)}
          </div>
        </div>
      </TooltipProvider>
    </aside>
  )
}

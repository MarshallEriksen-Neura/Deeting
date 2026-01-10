export interface NavItem {
  label: string
  href: string
  isActive?: boolean
}

export interface HeaderProps {
  logoSrc?: string
  logoText?: string
  navItems?: NavItem[]
  userName?: string
  userEmail?: string
  userAvatarSrc?: string
  onMenuClick?: () => void
  className?: string
}

"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

import { Header } from "@/components/layout/Header"
import type { HeaderProps } from "@/components/layout/header/types"

type HeaderShellProps = HeaderProps & {
  children: ReactNode
}

function shouldHideHeader(pathname: string | null) {
  return Boolean(
    pathname?.startsWith("/chat") ||
    pathname?.startsWith("/spec-agent")
  )
}

export function HeaderShell({ children, ...headerProps }: HeaderShellProps) {
  const pathname = usePathname()
  const hideHeader = shouldHideHeader(pathname)

  return (
    <>
      {!hideHeader && <Header {...headerProps} />}
      <div className={hideHeader ? undefined : "pt-24"}>
        {children}
      </div>
    </>
  )
}

export default HeaderShell

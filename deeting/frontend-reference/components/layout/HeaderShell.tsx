"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

import { Header } from "@/components/layout/Header"
import type { HeaderProps } from "@/components/layout/header/types"
import { shouldHideGlobalHeader } from "@/components/layout/header/visibility"

type HeaderShellProps = HeaderProps & {
  children: ReactNode
}

export function HeaderShell({ children, ...headerProps }: HeaderShellProps) {
  const pathname = usePathname()
  const hideHeader = shouldHideGlobalHeader(pathname)

  return (
    <>
      {!hideHeader && <Header {...headerProps} />}
      <div
        style={
          hideHeader
            ? undefined
            : { paddingTop: "var(--app-header-offset, 5rem)" }
        }
      >
        {children}
      </div>
    </>
  )
}

export default HeaderShell

import React from "react"
import { render, screen } from "@testing-library/react"
import { UserMenu } from "@/components/layout/header/UserMenu"

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
}))

jest.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock("@/components/ui/glass-dropdown", () => ({
  GlassDropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  GlassDropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  GlassDropdownMenuItem: ({ children }: React.PropsWithChildren<{ asChild?: boolean }>) => <div>{children}</div>,
  GlassDropdownMenuSeparator: () => <hr />,
  GlassDropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  GlassDropdownUserHeader: ({ name, email }: { name: string; email: string }) => <div>{name}:{email}</div>,
}))

describe("UserMenu", () => {
  it("shows admin dashboard link for admins", () => {
    render(<UserMenu userName="Admin" userEmail="admin@example.com" isAdmin />)

    const adminLink = screen.getByRole("link", { name: "adminDashboard" })
    expect(adminLink).toHaveAttribute("href", "/admin")
  })

  it("hides admin dashboard link for regular users", () => {
    render(<UserMenu userName="User" userEmail="user@example.com" isAdmin={false} />)

    expect(screen.queryByRole("link", { name: "adminDashboard" })).not.toBeInTheDocument()
  })
})
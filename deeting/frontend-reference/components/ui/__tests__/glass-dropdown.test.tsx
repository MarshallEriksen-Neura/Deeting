import React from "react"
import { render, screen } from "@testing-library/react"

import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
} from "@/ui/common/glass-dropdown"

describe("GlassDropdownMenuItem", () => {
  it("renders slotted children without throwing when asChild is enabled", () => {
    expect(() => {
      render(
        <GlassDropdownMenu open>
          <GlassDropdownMenuContent forceMount>
            <GlassDropdownMenuItem asChild>
              <a href="/profile">Profile</a>
            </GlassDropdownMenuItem>
          </GlassDropdownMenuContent>
        </GlassDropdownMenu>
      )
    }).not.toThrow()

    expect(screen.getByRole("menuitem")).toHaveAttribute("href", "/profile")
    expect(screen.getByRole("menuitem")).toHaveTextContent("Profile")
  })
})

import { render, screen } from "@testing-library/react"
import { LayoutDashboard } from "lucide-react"

import { AdminPageShell } from "@/components/admin/admin-page-shell"

describe("AdminPageShell", () => {
  it("renders an icon node passed from a server page", () => {
    render(
      <AdminPageShell
        title="Dashboard"
        description="Overview"
        icon={<LayoutDashboard data-testid="admin-page-icon" />}
      >
        <div>Content</div>
      </AdminPageShell>
    )

    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Overview")).toBeInTheDocument()
    expect(screen.getByTestId("admin-page-icon")).toBeInTheDocument()
    expect(screen.getByText("Content")).toBeInTheDocument()
  })
})

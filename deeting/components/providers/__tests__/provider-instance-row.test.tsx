import React from "react"
import { render, waitFor } from "@testing-library/react"
import ProviderInstanceRow from "@/components/providers/provider-instance-row"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: React.PropsWithChildren) => (
    <div data-testid="responsive">{children}</div>
  ),
  LineChart: ({
    data,
    children,
  }: React.PropsWithChildren<{ data: Array<{ i: number; val: number }> }>) => (
    <div data-testid="line-chart" data-points={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: () => <div data-testid="line" />,
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({
    children,
    className,
  }: React.PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
}))

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}))

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked }: { checked: boolean }) => <input type="checkbox" readOnly checked={checked} />,
}))

jest.mock("@/components/ui/glass-dropdown", () => ({
  GlassDropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  GlassDropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  GlassDropdownMenuItem: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
  GlassDropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
}))

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogAction: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
  AlertDialogCancel: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

function readChartValues(container: HTMLElement): number[] {
  const chart = container.querySelector("[data-testid='line-chart']")
  if (!chart) return []
  const raw = chart.getAttribute("data-points")
  if (!raw) return []
  const points = JSON.parse(raw) as Array<{ i: number; val: number }>
  return points.map((item) => item.val)
}

describe("ProviderInstanceRow", () => {
  it("syncs chart data when sparkline arrives after initial render", async () => {
    const baseData = {
      id: "inst-1",
      name: "provider-a",
      presetName: "Custom HTTP",
      presetSlug: "custom",
      category: "custom",
      latency_ms: 0,
      health_status: "unknown",
      is_enabled: true,
      sparkline: [] as number[],
    }

    const { container, rerender } = render(
      <ProviderInstanceRow
        data={baseData}
        index={0}
        onToggle={jest.fn()}
        onDelete={jest.fn()}
      />
    )

    rerender(
      <ProviderInstanceRow
        data={{ ...baseData, sparkline: [120, 350, 200] }}
        index={0}
        onToggle={jest.fn()}
        onDelete={jest.fn()}
      />
    )

    await waitFor(() => {
      expect(readChartValues(container)).toEqual([120, 350, 200])
    })
  })
})

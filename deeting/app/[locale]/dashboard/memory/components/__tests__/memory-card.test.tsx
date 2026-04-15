import { fireEvent, render, screen } from "@testing-library/react"

import { MemoryCard } from "@/app/[locale]/dashboard/memory/components/memory-card"
import type { MemoryItem } from "@/types/memory"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "memory-1",
    content: "Remember that I prefer short answers.",
    payload: {},
    ...overrides,
  }
}

describe("MemoryCard", () => {
  it("falls back safely when payload source is not a string and shows unknown memory tiers verbatim", () => {
    render(
      <MemoryCard
        item={makeItem({
          source: null,
          memory_tier: "custom",
          payload: {
            source: { kind: "structured" },
            plugin_id: ["plugin-id"],
            type: { nested: true },
          },
        })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    )

    expect(screen.getByText("source.autoExtracted")).toBeInTheDocument()
    expect(screen.getByText("custom")).toBeInTheDocument()
  })

  it("renders supersession affordances for replaced and replacing memories", () => {
    const onHistory = jest.fn()

    const { rerender } = render(
      <MemoryCard
        item={makeItem({
          claim_state: "superseded",
          superseded_by: "memory-2",
        })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onHistory={onHistory}
      />
    )

    expect(screen.getByText("Superseded")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /view replacing memory/i }))
    expect(onHistory).toHaveBeenCalledWith("memory-2")

    rerender(
      <MemoryCard
        item={makeItem({
          supersedes: ["memory-0"],
        })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onHistory={onHistory}
      />
    )

    expect(screen.getByText("Supersedes")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /view previous memory/i }))
    expect(onHistory).toHaveBeenCalledWith("memory-0")
  })
})

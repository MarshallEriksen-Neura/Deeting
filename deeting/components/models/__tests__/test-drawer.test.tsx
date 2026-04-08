import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { TestDrawer } from "@/components/models/test-drawer"
import type { ProviderModel } from "@/components/models/types"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/textarea", () => ({
  Textarea: Object.assign(
    React.forwardRef<
      HTMLTextAreaElement,
      React.TextareaHTMLAttributes<HTMLTextAreaElement>
    >((props, ref) => <textarea ref={ref} {...props} />),
    { displayName: "MockTextarea" }
  ),
}))

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) => (
    <div>{children}</div>
  ),
  SheetContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  SheetHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  SheetDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

const model: ProviderModel = {
  uuid: "model-1",
  id: "MiniMax-M2.7",
  object: "model",
  display_name: "MiniMax-M2.7",
  unified_model_id: "MiniMax-M2.7",
  capabilities: ["chat"],
  context_window: 0,
  pricing: { input: 0, output: 0 },
  is_active: true,
  updated_at: "2026-04-08T00:00:00Z",
}

describe("TestDrawer", () => {
  it("uses a shrinkable native scroll container for long test responses", async () => {
    const onSendMessage = jest.fn().mockResolvedValue({
      id: "assistant-1",
      role: "assistant" as const,
      content: JSON.stringify({ base_resp: { status_code: 0 }, choices: [{ message: { content: "你好" } }] }, null, 2),
      timestamp: "2026-04-08T00:00:00Z",
    })

    const { container } = render(
      <TestDrawer
        isOpen
        onClose={() => {}}
        model={model}
        instanceName="Minimax"
        onSendMessage={onSendMessage}
      />
    )

    const scrollContainer = container.querySelector(
      ".min-h-0.flex-1.overflow-y-auto.overflow-x-hidden"
    ) as HTMLDivElement | null

    expect(scrollContainer).not.toBeNull()

    Object.defineProperty(scrollContainer, "scrollHeight", {
      value: 900,
      configurable: true,
    })
    scrollContainer.scrollTop = 0

    fireEvent.change(screen.getByPlaceholderText("test.placeholder"), {
      target: { value: "你好" },
    })
    fireEvent.click(screen.getAllByRole("button")[0])

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith("你好")
      expect(screen.getByText(/"status_code": 0/)).toBeInTheDocument()
    })

    expect(scrollContainer.scrollTop).toBe(900)
  })
})

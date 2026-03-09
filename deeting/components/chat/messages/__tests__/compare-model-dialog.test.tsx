import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { CompareModelDialog } from "@/components/chat/messages/compare-model-dialog"
import type { ModelInfo } from "@/lib/api/models"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/components/models/model-picker", () => ({
  resolveModelVisual: () => ({
    icon: ({ className }: { className?: string }) => <svg data-testid="model-icon" className={className} />,
    color: "text-foreground",
  }),
}))

const models: ModelInfo[] = [
  { id: "qwen-local", provider_model_id: "local-1", request_route: "local_invoke", runtime_source: "desktop_local" },
  { id: "llama-local", provider_model_id: "local-2", request_route: "local_invoke", runtime_source: "desktop_local" },
  { id: "gpt-cloud", provider_model_id: "cloud-1", request_route: "cloud_http", runtime_source: "cloud_internal" },
]

describe("CompareModelDialog", () => {
  it("shows only eligible local models and excludes existing candidates", () => {
    render(
      <CompareModelDialog
        open
        onOpenChange={jest.fn()}
        models={models}
        excludedModelKeys={["local-1"]}
        onSelect={jest.fn()}
      />
    )

    expect(screen.queryByRole("button", { name: /qwen-local/i })).toBeNull()
    expect(screen.getByRole("button", { name: /llama-local/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /gpt-cloud/i })).toBeNull()
  })

  it("filters by search keyword and selects a model", () => {
    const onSelect = jest.fn()
    const onOpenChange = jest.fn()

    render(
      <CompareModelDialog
        open
        onOpenChange={onOpenChange}
        models={models}
        excludedModelKeys={[]}
        onSelect={onSelect}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("compare.dialog.searchPlaceholder"), {
      target: { value: "llama" },
    })
    fireEvent.click(screen.getByRole("button", { name: /llama-local/i }))

    expect(onSelect).toHaveBeenCalledWith("local-2")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
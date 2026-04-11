import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { ModelConfigPanel } from "@/components/models/model-config-panel"
import type { ProviderModel } from "@/components/models/types"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({
    children,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

jest.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}))

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))

const imageModel: ProviderModel = {
  uuid: "model-1",
  id: "qwen-image",
  object: "model",
  display_name: "Qwen Image",
  unified_model_id: "qwen-image",
  capabilities: ["image_generation"],
  context_window: 0,
  pricing: { input: 0, output: 0 },
  is_active: true,
  upstream_path: "images/generations",
  request_url: "https://example.com/images/generations",
  weight: 0,
  priority: 0,
  updated_at: "2026-03-24T00:00:00Z",
  routing_config: {
    capabilities: ["image_generation"],
    max_input_images: 2,
  } as Record<string, unknown>,
  max_input_images: 2,
}

const chatModel: ProviderModel = {
  uuid: "model-2",
  id: "deepseek-reasoner",
  object: "model",
  display_name: "DeepSeek Reasoner",
  unified_model_id: "deepseek-reasoner",
  capabilities: ["chat"],
  context_window: 64000,
  pricing: { input: 0, output: 0 },
  is_active: true,
  upstream_path: "chat/completions",
  request_url: "https://example.com/v1/chat/completions",
  weight: 100,
  priority: 0,
  updated_at: "2026-04-11T00:00:00Z",
  routing_config: {},
  config_override: {},
}

describe("ModelConfigPanel", () => {
  it("shows custom image mode as OpenAI-compatible and saves image input limits", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)

    render(<ModelConfigPanel model={imageModel} onSave={onSave} />)

    expect((screen.getByDisplayValue("2") as HTMLInputElement).value).toBe("2")
    expect(screen.getByDisplayValue("advanced.imageProtocol.modeValue")).not.toBeNull()

    fireEvent.change(screen.getByDisplayValue("2"), {
      target: { value: "3" },
    })

    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [, payload] = onSave.mock.calls[0]
    expect(payload.routing_config).toEqual({
      capabilities: ["image_generation"],
      max_input_images: 3,
    })
    expect(payload.config_override).toBeUndefined()
  })

  it("saves chat content compatibility override when string-only mode is selected", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)

    render(<ModelConfigPanel model={chatModel} onSave={onSave} />)

    fireEvent.click(screen.getByRole("button", { name: "basic.chatContentCompatibilityModes.stringOnly" }))
    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [, payload] = onSave.mock.calls[0]
    expect(payload.config_override).toEqual({
      chat_content_compatibility: "string_only",
    })
  })
})

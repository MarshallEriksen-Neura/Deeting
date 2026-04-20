import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { CompareResponseShell } from "@/components/chat/messages/compare-response-shell"
import type { ModelInfo } from "@/lib/api/models"
import type { MessageCompareState } from "@/store/chat-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/components/ui/tabs", () => {
  const React = require("react")
  const TabsContext = React.createContext({
    value: null as string | null,
    onValueChange: (_value: string) => {},
  })

  return {
    Tabs: ({ children, value, onValueChange }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>
    ),
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: any) => {
      const context = React.useContext(TabsContext)
      return (
        <button role="tab" type="button" onClick={() => context.onValueChange(value)}>
          {children}
        </button>
      )
    },
    TabsContent: ({ children, value }: any) => {
      const context = React.useContext(TabsContext)
      return context.value === value ? <div>{children}</div> : null
    },
  }
})

jest.mock("@/components/chat/messages/ai-response-bubble", () => ({
  AIResponseBubble: ({ parts }: { parts: Array<{ content?: string }> }) => (
    <div data-testid="ai-bubble">{parts.map((part) => part.content ?? "").join("")}</div>
  ),
}))

jest.mock("@/components/chat/messages/compare-model-dialog", () => ({
  CompareModelDialog: ({ open, models, excludedModelKeys, onSelect }: any) =>
    open ? (
      <div data-testid="compare-dialog">
        {models
          .filter((model: ModelInfo) => !excludedModelKeys.includes(model.provider_model_id ?? model.id))
          .map((model: ModelInfo) => {
            const value = model.provider_model_id ?? model.id
            return (
              <button key={value} type="button" onClick={() => onSelect(value)}>
                {model.id}
              </button>
            )
          })}
      </div>
    ) : null,
}))

const models: ModelInfo[] = [
  { id: "baseline", provider_model_id: "model-a", request_route: "local_invoke", runtime_source: "desktop_local" },
  { id: "candidate", provider_model_id: "model-b", request_route: "local_invoke", runtime_source: "desktop_local" },
  { id: "extra", provider_model_id: "model-c", request_route: "local_invoke", runtime_source: "desktop_local" },
]

const buildCompareState = (activeModelKey = "model-a"): MessageCompareState => ({
  messageId: "msg-1",
  baselineModelKey: "model-a",
  activeModelKey,
  isFinalizing: false,
  candidates: {
    "model-a": { modelKey: "model-a", modelId: "baseline", content: "base", blocks: [{ type: "text", content: "base" } as any], loading: false, baseline: true },
    "model-b": { modelKey: "model-b", modelId: "candidate", content: "alt", blocks: [{ type: "text", content: "alt" } as any], loading: false },
  },
})

describe("CompareResponseShell", () => {
  it("switches candidates through tab callback and finalizes active candidate", () => {
    const onCompare = jest.fn()
    const onFinalize = jest.fn()

    render(
      <CompareResponseShell
        messageId="msg-1"
        compareState={buildCompareState("model-b")}
        models={models}
        onCompare={onCompare}
        onFinalize={onFinalize}
      />
    )

    fireEvent.click(screen.getByRole("tab", { name: /baseline/i }))
    fireEvent.click(screen.getByRole("button", { name: "compare.actions.useAsFinal" }))

    expect(onCompare).toHaveBeenCalledWith("msg-1", "model-a")
    expect(onFinalize).toHaveBeenCalledWith("msg-1", "model-b")
  })

  it("opens add-model dialog and forwards selected model", () => {
    const onCompare = jest.fn()

    render(
      <CompareResponseShell
        messageId="msg-1"
        compareState={buildCompareState()}
        models={models}
        onCompare={onCompare}
        onFinalize={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /compare.actions.addModel/i }))
    fireEvent.click(screen.getByRole("button", { name: "extra" }))

    expect(onCompare).toHaveBeenCalledWith("msg-1", "model-c")
  })
})
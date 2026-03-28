import { fireEvent, render, screen } from "@testing-library/react"

import { ModelPickerField } from "@/components/models/model-picker-field"

jest.mock("@/components/models/model-picker", () => ({
  ModelPicker: ({
    searchPlaceholder,
    modelGroups,
  }: {
    searchPlaceholder: string
    modelGroups: Array<{ models: Array<{ id: string }> }>
  }) => (
    <div>
      <input placeholder={searchPlaceholder} readOnly />
      {modelGroups.flatMap((group) => group.models).map((model) => (
        <div key={model.id}>{model.id}</div>
      ))}
    </div>
  ),
}))

jest.mock("@/components/models/model-visual", () => ({
  resolveModelVisual: () => ({
    icon: () => null,
    color: "text-foreground",
    indicator: "bg-foreground",
  }),
}))

describe("ModelPickerField", () => {
  it("opens the searchable model picker for channel reply model selection", () => {
    render(
      <ModelPickerField
        id="wechat-bot-model"
        label="回复模型"
        placeholder="选择一个回复模型（可选）"
        value=""
        onChange={jest.fn()}
        searchPlaceholder="搜索模型..."
        emptyText="暂无可用模型，请先添加"
        noResultsText="未找到匹配的模型"
        modelGroups={[
          {
            instance_id: "provider-1",
            instance_name: "联通云",
            provider: "custom",
            models: [
              {
                id: "grok-4-thinking",
                provider_model_id: "pm-1",
                owned_by: "custom",
              },
            ],
          },
        ]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "回复模型" }))

    expect(screen.getByPlaceholderText("搜索模型...")).toBeTruthy()
    expect(screen.getByText("grok-4-thinking")).toBeTruthy()
  })
})

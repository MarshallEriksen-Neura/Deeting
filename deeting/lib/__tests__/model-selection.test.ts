import { getModelConfigReference, hasSecretaryModelSelection } from "@/lib/model-selection"

describe("model selection helpers", () => {
  it("prefers provider_model_id when resolving model_config references", () => {
    expect(
      getModelConfigReference({
        provider_model_id: "22222222-2222-4222-8222-222222222222",
        model: "gpt-4o-mini",
        model_name: "legacy-name",
      })
    ).toBe("22222222-2222-4222-8222-222222222222")
  })

  it("falls back from model to legacy model_name", () => {
    expect(getModelConfigReference({ model: "gpt-4.1" })).toBe("gpt-4.1")
    expect(getModelConfigReference({ model_name: "legacy-model" })).toBe("legacy-model")
  })

  it("treats secretary provider_model_id as configured", () => {
    expect(
      hasSecretaryModelSelection({
        model_name: null,
        provider_model_id: "22222222-2222-4222-8222-222222222222",
      })
    ).toBe(true)
    expect(hasSecretaryModelSelection({ model_name: "", provider_model_id: " " })).toBe(false)
  })
})
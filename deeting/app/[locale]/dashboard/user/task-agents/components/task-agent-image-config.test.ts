import {
  applyTaskAgentImageConfigToModelConfig,
  buildTaskAgentImageConfigDraft,
  createEmptyTaskAgentImageConfigDraft,
  parseTaskAgentImageExtraParamsJson,
} from "./task-agent-image-config"

describe("task-agent-image-config", () => {
  it("reads structured image_generation defaults from model_config", () => {
    const draft = buildTaskAgentImageConfigDraft({
      model: "Qwen-Image",
      image_generation: {
        negative_prompt: "blurry",
        aspect_ratio: "16:9",
        num_outputs: 2,
        steps: 30,
        cfg_scale: 7.5,
        image_url: "https://example.com/cat.png",
        extra_params: {
          prompt_optimizer: true,
        },
      },
    })

    expect(draft.negative_prompt).toBe("blurry")
    expect(draft.aspect_ratio).toBe("16:9")
    expect(draft.num_outputs).toBe("2")
    expect(draft.steps).toBe("30")
    expect(draft.cfg_scale).toBe("7.5")
    expect(draft.image_url).toBe("https://example.com/cat.png")
    expect(draft.extra_params_json).toContain('"prompt_optimizer": true')
  })

  it("merges structured image config into model_config without clobbering model selection", () => {
    const next = applyTaskAgentImageConfigToModelConfig(
      {
        model: "Qwen-Image",
        provider_model_id: "provider-1",
      },
      {
        ...createEmptyTaskAgentImageConfigDraft(),
        aspect_ratio: "1:1",
        num_outputs: "3",
        steps: "28",
        cfg_scale: "6.5",
        image_url: "https://example.com/reference.png",
      },
      {
        prompt_optimizer: true,
      },
    )

    expect(next.model).toBe("Qwen-Image")
    expect(next.provider_model_id).toBe("provider-1")
    expect(next.image_generation).toEqual({
      aspect_ratio: "1:1",
      num_outputs: 3,
      steps: 28,
      cfg_scale: 6.5,
      image_url: "https://example.com/reference.png",
      extra_params: {
        prompt_optimizer: true,
      },
    })
  })

  it("removes empty image_generation config from model_config", () => {
    const next = applyTaskAgentImageConfigToModelConfig(
      {
        model: "Qwen-Image",
        image_generation: {
          aspect_ratio: "16:9",
        },
      },
      createEmptyTaskAgentImageConfigDraft(),
      null,
    )

    expect(next).toEqual({
      model: "Qwen-Image",
    })
  })

  it("rejects non-object extra params json", () => {
    expect(parseTaskAgentImageExtraParamsJson("[]")).toEqual({
      value: null,
      error: "Image extra params JSON must be a valid object.",
    })
  })
})

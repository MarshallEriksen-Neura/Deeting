import {
  applyTaskAgentVoiceConfigToModelConfig,
  buildTaskAgentVoiceConfigDraft,
  createEmptyTaskAgentVoiceConfigDraft,
  parseTaskAgentVoiceExtraParamsJson,
} from "./task-agent-voice-config"

describe("task-agent-voice-config", () => {
  it("reads structured text_to_speech defaults from model_config", () => {
    const draft = buildTaskAgentVoiceConfigDraft({
      model: "tts-1",
      text_to_speech: {
        voice: "alloy",
        response_format: "mp3",
        speed: 1.1,
        extra_params: {
          style: "warm",
        },
      },
    })

    expect(draft.voice).toBe("alloy")
    expect(draft.response_format).toBe("mp3")
    expect(draft.speed).toBe("1.1")
    expect(draft.extra_params_json).toContain('"style": "warm"')
  })

  it("merges structured voice config into model_config without clobbering model selection", () => {
    const next = applyTaskAgentVoiceConfigToModelConfig(
      {
        model: "tts-1",
        provider_model_id: "provider-voice",
      },
      {
        ...createEmptyTaskAgentVoiceConfigDraft(),
        voice: "nova",
        response_format: "wav",
        speed: "1.2",
      },
      { style: "radio" },
    )

    expect(next.model).toBe("tts-1")
    expect(next.provider_model_id).toBe("provider-voice")
    expect(next.text_to_speech).toEqual({
      voice: "nova",
      response_format: "wav",
      speed: 1.2,
      extra_params: { style: "radio" },
    })
  })

  it("rejects non-object voice extra params json", () => {
    expect(parseTaskAgentVoiceExtraParamsJson("[]")).toEqual({
      value: null,
      error: "Voice extra params JSON must be a valid object.",
    })
  })
})

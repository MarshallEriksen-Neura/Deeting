import {
  FEISHU_FIELD_GROUPS,
  FIELD_DEFS,
  configToFormValues,
} from "@/app/[locale]/dashboard/notification-channels/components/channel-form-schema"

describe("channel-form-schema", () => {
  it("includes wechat proactive notify contacts field", () => {
    const field = FIELD_DEFS.wechat.find((item) => item.key === "notify_contact_ids")

    expect(field).toBeTruthy()
    expect(field?.type).toBe("textarea")
    expect(field?.valueKind).toBe("string[]")
  })

  it("does not expose per-channel reply model selection for desktop IM channels", () => {
    expect(FIELD_DEFS.feishu.some((field) => field.key === "bot_model")).toBe(false)
    expect(FIELD_DEFS.wechat.some((field) => field.key === "bot_model")).toBe(false)
  })

  it("can hydrate IM fields from nested im_config", () => {
    const values = configToFormValues(FIELD_DEFS.telegram, {
      im_config: {
        im_enabled: true,
        bot_token: "telegram-token",
        chat_id: "12345",
      },
    })

    expect(values.im_enabled).toBe(true)
    expect(values.bot_token).toBe("telegram-token")
    expect(values.chat_id).toBe("12345")
  })

  it("prefers nested im_config over legacy root fields", () => {
    const values = configToFormValues(FIELD_DEFS.telegram, {
      im_enabled: false,
      bot_token: "legacy-token",
      chat_id: "legacy-chat",
      im_config: {
        im_enabled: true,
        bot_token: "nested-token",
        chat_id: "nested-chat",
      },
    })

    expect(values.im_enabled).toBe(true)
    expect(values.bot_token).toBe("nested-token")
    expect(values.chat_id).toBe("nested-chat")
  })

  it("keeps feishu reply behavior focused on prompt styling only", () => {
    const replyBehaviorGroup = FEISHU_FIELD_GROUPS.find(
      (group) => group.titleKey === "feishuGroups.replyBehavior.title"
    )

    expect(replyBehaviorGroup?.keys).toEqual(["bot_system_prompt"])
  })
})

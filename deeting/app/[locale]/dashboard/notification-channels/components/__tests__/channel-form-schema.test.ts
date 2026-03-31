import {
  FEISHU_FIELD_GROUPS,
  FIELD_DEFS,
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

  it("keeps feishu reply behavior focused on prompt styling only", () => {
    const replyBehaviorGroup = FEISHU_FIELD_GROUPS.find(
      (group) => group.titleKey === "feishuGroups.replyBehavior.title"
    )

    expect(replyBehaviorGroup?.keys).toEqual(["bot_system_prompt"])
  })
})

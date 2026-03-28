import { FIELD_DEFS } from "../channel-form-schema"

describe("channel form schema", () => {
  it("includes wechat proactive notify contacts field", () => {
    const field = FIELD_DEFS.wechat.find((item) => item.key === "notify_contact_ids")

    expect(field).toBeTruthy()
    expect(field?.type).toBe("textarea")
    expect(field?.valueKind).toBe("string[]")
  })
})

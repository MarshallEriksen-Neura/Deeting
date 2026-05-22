import {
  buildChatFeedbackPayload,
  hasActionableFeedbackReason,
} from "./feedback-payload"

describe("chat feedback payload", () => {
  it("normalizes reason ids and comment into trace feedback payload tags", () => {
    const payload = buildChatFeedbackPayload(
      "negative",
      ["missing_artifact", "missing_artifact", "  fact_error  ", ""],
      "  claimed the file was created but no artifact exists  "
    )

    expect(payload).toEqual({
      comment: "claimed the file was created but no artifact exists",
      tags: ["chat_feedback", "negative", "missing_artifact", "fact_error"],
    })
    expect(hasActionableFeedbackReason(payload)).toBe(true)
  })

  it("keeps positive feedback submittable without a specific reason", () => {
    const payload = buildChatFeedbackPayload("positive", [], "   ")

    expect(payload).toEqual({
      comment: null,
      tags: ["chat_feedback", "positive"],
    })
    expect(hasActionableFeedbackReason(payload)).toBe(false)
  })

  it("treats a free-text comment as actionable even without a reason tag", () => {
    const payload = buildChatFeedbackPayload("negative", [], "missed the user's language")

    expect(payload).toEqual({
      comment: "missed the user's language",
      tags: ["chat_feedback", "negative"],
    })
    expect(hasActionableFeedbackReason(payload)).toBe(true)
  })
})

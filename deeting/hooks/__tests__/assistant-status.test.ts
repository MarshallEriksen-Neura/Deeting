import { getAssistantStatusLabel } from "@/components/assistants/assistant-status"

describe("getAssistantStatusLabel", () => {
  it("returns draft for private draft", () => {
    expect(getAssistantStatusLabel("private", "draft")).toBe("draft")
  })

  it("returns published for public published", () => {
    expect(getAssistantStatusLabel("public", "published")).toBe("published")
  })

  it("returns archived for archived", () => {
    expect(getAssistantStatusLabel("public", "archived")).toBe("archived")
  })
})

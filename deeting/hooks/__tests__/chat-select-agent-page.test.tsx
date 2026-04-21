import SelectAgentPage from "@/app/[locale]/chat/select-agent/page"

const redirectMock = jest.fn()

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}))

describe("SelectAgentPage", () => {
  const originalIsTauri = process.env.NEXT_PUBLIC_IS_TAURI

  beforeEach(() => {
    redirectMock.mockClear()
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = originalIsTauri
  })

  it("redirects desktop users to task agents", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"

    SelectAgentPage()

    expect(redirectMock).toHaveBeenCalledWith("/agents/task-agents")
  })

  it("redirects web users back to chat", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    SelectAgentPage()

    expect(redirectMock).toHaveBeenCalledWith("/chat")
  })
})

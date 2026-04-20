import AssistantsPage from "@/app/[locale]/assistants/page"

const redirectMock = jest.fn()
const setRequestLocaleMock = jest.fn()

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}))

jest.mock("next-intl/server", () => ({
  setRequestLocale: (...args: unknown[]) => setRequestLocaleMock(...args),
}))

describe("AssistantsPage", () => {
  beforeEach(() => {
    redirectMock.mockClear()
    setRequestLocaleMock.mockClear()
  })

  it("redirects assistant route to task agents", async () => {
    await AssistantsPage({
      params: Promise.resolve({ locale: "en" }),
    })

    expect(setRequestLocaleMock).toHaveBeenCalledWith("en")
    expect(redirectMock).toHaveBeenCalledWith("/en/dashboard/user/task-agents")
  })
})

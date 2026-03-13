import {
  confirmDesktopOAuthBindingGrant,
  fetchAccountBindings,
} from "@/lib/api/account-bindings"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>

describe("account bindings api", () => {
  afterEach(() => {
    mockRequest.mockReset()
  })

  it("parses account bindings payload", async () => {
    mockRequest.mockResolvedValue({
      oauth: {
        google: { is_bound: true, display_name: "Google User", bound_at: "2026-03-13T00:00:00Z" },
        github: { is_bound: false, display_name: null, bound_at: null },
      },
      email: {
        primary_email: "user@example.com",
        aliases: [{ email: "alias@example.com", bound_at: "2026-03-13T00:00:01Z" }],
      },
    })

    const result = await fetchAccountBindings()

    expect(result.oauth.google.is_bound).toBe(true)
    expect(result.email.aliases[0]?.email).toBe("alias@example.com")
  })

  it("parses desktop oauth bind confirm payload", async () => {
    mockRequest.mockResolvedValue({
      provider: "google",
      is_bound: true,
      display_name: "Bound Google User",
    })

    const result = await confirmDesktopOAuthBindingGrant({
      provider: "google",
      session_id: "sess-1",
      state: "state-1",
      grant: "grant-1",
    })

    expect(result.provider).toBe("google")
    expect(result.is_bound).toBe(true)
  })
})

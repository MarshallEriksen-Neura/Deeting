import { updateUserProfile } from "@/lib/api/user"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>

describe("updateUserProfile", () => {
  afterEach(() => {
    mockRequest.mockReset()
  })

  it("fills fallback permission_flags when patch response does not contain permission_flags", async () => {
    mockRequest.mockResolvedValue({
      id: "u-1",
      email: "user@example.com",
      username: "user",
      avatar_url: "https://example.com/a.png",
      is_active: true,
      is_superuser: false,
      created_at: "2026-03-02T00:00:00Z",
      updated_at: "2026-03-02T00:00:01Z",
    })

    const result = await updateUserProfile(
      { avatar_object_key: "assets/avatar/a.png", avatar_storage_type: "public" },
      { "chat.pro": 1 }
    )

    expect(result.permission_flags).toEqual({ "chat.pro": 1 })
  })

  it("prefers permission_flags from backend when present", async () => {
    mockRequest.mockResolvedValue({
      id: "u-1",
      email: "user@example.com",
      username: "user",
      avatar_url: "https://example.com/a.png",
      is_active: true,
      is_superuser: false,
      created_at: "2026-03-02T00:00:00Z",
      updated_at: "2026-03-02T00:00:01Z",
      permission_flags: {
        "chat.pro": 2,
      },
    })

    const result = await updateUserProfile(
      { username: "new-user" },
      { "chat.pro": 1 }
    )

    expect(result.permission_flags).toEqual({ "chat.pro": 2 })
  })
})

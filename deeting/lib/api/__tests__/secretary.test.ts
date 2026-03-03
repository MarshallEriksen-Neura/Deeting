import { fetchUserSecretary, updateUserSecretary } from "@/lib/api/secretary"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

const localSecretary = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "00000000-0000-0000-0000-000000000000",
  name: "deeting",
  model_name: "gpt-4o-mini",
  created_at: "2026-03-03T00:00:00Z",
  updated_at: "2026-03-03T00:00:01Z",
}

describe("secretary api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches secretary via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(localSecretary as unknown)

    const result = await fetchUserSecretary()

    expect(result).toEqual(localSecretary)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_user_secretary", undefined)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("updates secretary via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      ...localSecretary,
      model_name: "gpt-4.1",
      updated_at: "2026-03-03T00:10:00Z",
    } as unknown)

    const result = await updateUserSecretary({ model_name: "gpt-4.1" })

    expect(result.model_name).toBe("gpt-4.1")
    expect(mockInvoke).toHaveBeenCalledWith("update_local_user_secretary", {
      payload: { model_name: "gpt-4.1" },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("fetches secretary from cloud outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue(localSecretary)

    const result = await fetchUserSecretary()

    expect(result).toEqual(localSecretary)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/users/me/secretary",
      method: "GET",
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

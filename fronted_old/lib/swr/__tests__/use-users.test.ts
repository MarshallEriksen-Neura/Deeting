import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCreateUser, useUpdateUserStatus } from "../use-users";
import { userService } from "@/http/user";
import { swrKeys } from "../keys";

const { mutateMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
}));

vi.mock("swr", async () => {
  const actual = await vi.importActual<any>("swr");
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: mutateMock }),
  };
});

vi.mock("@/http/user", () => ({
  userService: {
    createUser: vi.fn(),
    updateUserStatus: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => children;

describe("use-users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("useCreateUser should call userService.createUser", async () => {
    vi.mocked(userService.createUser).mockResolvedValue({
      id: "u1",
      username: "u1",
      email: "u1@example.com",
      display_name: null,
      avatar: null,
      is_active: true,
      is_superuser: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });

    const { result } = renderHook(() => useCreateUser(), { wrapper });
    const created = await result.current({ email: "u1@example.com", password: "pw" });

    expect(created.id).toBe("u1");
    expect(userService.createUser).toHaveBeenCalledWith({
      email: "u1@example.com",
      password: "pw",
    });
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUsers());
  });

  it("useUpdateUserStatus should call userService.updateUserStatus", async () => {
    vi.mocked(userService.updateUserStatus).mockResolvedValue({
      id: "u1",
      username: "u1",
      email: "u1@example.com",
      display_name: null,
      avatar: null,
      is_active: false,
      is_superuser: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });

    const { result } = renderHook(() => useUpdateUserStatus(), { wrapper });
    const updated = await result.current("u1", { is_active: false });

    expect(updated.is_active).toBe(false);
    expect(userService.updateUserStatus).toHaveBeenCalledWith("u1", { is_active: false });
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUsers());
  });
});

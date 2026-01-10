import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSetUserRoles } from "../use-user-roles";
import { useGrantUserPermission, useRevokeUserPermission } from "../use-user-permissions";
import { adminService } from "@/http/admin";
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

vi.mock("@/http/admin", () => ({
  adminService: {
    setUserRoles: vi.fn(),
    grantUserPermission: vi.fn(),
    revokeUserPermission: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => children;

describe("admin user mutation hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("useSetUserRoles should call adminService.setUserRoles and invalidate caches", async () => {
    vi.mocked(adminService.setUserRoles).mockResolvedValue([]);

    const { result } = renderHook(() => useSetUserRoles(), { wrapper });
    await result.current("u1", ["r1", "r2"]);

    expect(adminService.setUserRoles).toHaveBeenCalledWith("u1", ["r1", "r2"]);
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUserRoles("u1"));
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUsers());
  });

  it("useGrantUserPermission should call adminService.grantUserPermission and invalidate caches", async () => {
    vi.mocked(adminService.grantUserPermission).mockResolvedValue({
      id: "p1",
      user_id: "u1",
      permission_type: "perm.a",
      permission_value: null,
      expires_at: null,
      notes: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });

    const { result } = renderHook(() => useGrantUserPermission(), { wrapper });
    await result.current("u1", { permission_type: "perm.a" });

    expect(adminService.grantUserPermission).toHaveBeenCalledWith("u1", { permission_type: "perm.a" });
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUserPermissions("u1"));
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUsers());
  });

  it("useRevokeUserPermission should call adminService.revokeUserPermission and invalidate caches", async () => {
    vi.mocked(adminService.revokeUserPermission).mockResolvedValue(undefined);

    const { result } = renderHook(() => useRevokeUserPermission(), { wrapper });
    await result.current("u1", "p1");

    expect(adminService.revokeUserPermission).toHaveBeenCalledWith("u1", "p1");
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUserPermissions("u1"));
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.adminUsers());
  });
});

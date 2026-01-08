import { describe, it, expect } from "vitest";
import { swrKeys } from "../keys";

describe("swrKeys", () => {
  it("should build stable admin keys", () => {
    expect(swrKeys.adminUsers()).toBe("/admin/users");
    expect(swrKeys.adminRoles()).toBe("/admin/roles");
    expect(swrKeys.adminPermissions()).toBe("/admin/permissions");
    expect(swrKeys.providerSubmissionsMe()).toBe("/providers/submissions/me");
  });

  it("should build user-scoped keys", () => {
    expect(swrKeys.adminUserRoles("u1")).toBe("/admin/users/u1/roles");
    expect(swrKeys.adminUserPermissions("u1")).toBe("/admin/users/u1/permissions");
  });
});

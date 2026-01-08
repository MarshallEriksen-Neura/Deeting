"use client";

import { useSWRConfig } from "swr";
import { useApiGet } from './hooks';
import type { UserPermission } from '@/lib/api-types';
import type { GrantPermissionRequest } from "@/lib/api-types";
import { adminService } from "@/http/admin";
import { swrKeys } from "./keys";

/**
 * 获取指定用户的权限列表
 */
export const useUserPermissions = (userId: string | null) => {
  const {
    data,
    error,
    loading,
    refresh
  } = useApiGet<UserPermission[]>(
    userId ? `/admin/users/${userId}/permissions` : null,
    { strategy: 'frequent' }
  );

  return {
    permissions: data || [],
    loading,
    error,
    refresh
  };
};

/**
 * 授予用户权限（写操作）
 * 统一缓存失效：用户权限列表 + 管理员用户列表
 */
export const useGrantUserPermission = () => {
  const { mutate } = useSWRConfig();

  return async (userId: string, request: GrantPermissionRequest) => {
    const created = await adminService.grantUserPermission(userId, request);
    await Promise.allSettled([
      mutate(swrKeys.adminUserPermissions(userId)),
      mutate(swrKeys.adminUsers()),
    ]);
    return created;
  };
};

/**
 * 撤销用户权限（写操作）
 * 统一缓存失效：用户权限列表 + 管理员用户列表
 */
export const useRevokeUserPermission = () => {
  const { mutate } = useSWRConfig();

  return async (userId: string, permissionId: string) => {
    await adminService.revokeUserPermission(userId, permissionId);
    await Promise.allSettled([
      mutate(swrKeys.adminUserPermissions(userId)),
      mutate(swrKeys.adminUsers()),
    ]);
  };
};

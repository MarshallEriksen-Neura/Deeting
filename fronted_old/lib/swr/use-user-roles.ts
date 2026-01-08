"use client";

import useSWR from "swr";
import { adminService, type Role } from "@/http/admin";
import { useSWRConfig } from "swr";
import { swrKeys } from "./keys";

/**
 * 获取系统中定义的全部角色
 */
export function useAllRoles() {
  const { data, error, isLoading, mutate } = useSWR<Role[]>(
    swrKeys.adminRoles(),
    () => adminService.getRoles(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  return {
    roles: data || [],
    loading: isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * 获取指定用户当前绑定的角色列表
 */
export function useUserRoles(userId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Role[]>(
    userId ? swrKeys.adminUserRoles(userId) : null,
    () => (userId ? adminService.getUserRoles(userId) : Promise.resolve([])),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  return {
    roles: data || [],
    loading: isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * 设置用户角色（写操作）
 * 统一在这里处理缓存失效，避免组件里散落 mutate/key 逻辑。
 */
export function useSetUserRoles() {
  const { mutate } = useSWRConfig();

  return async (userId: string, roleIds: string[]) => {
    const updatedRoles = await adminService.setUserRoles(userId, roleIds);
    await Promise.allSettled([
      mutate(swrKeys.adminUserRoles(userId)),
      mutate(swrKeys.adminUsers()),
    ]);
    return updatedRoles;
  };
}

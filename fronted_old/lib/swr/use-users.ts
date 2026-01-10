"use client";

import { useSWRConfig } from "swr";
import { userService, type CreateUserRequest, type UpdateUserStatusRequest } from "@/http/user";
import { swrKeys } from "./keys";

/**
 * 创建用户（写操作）
 * 创建成功后刷新管理员用户列表。
 */
export function useCreateUser() {
  const { mutate } = useSWRConfig();

  return async (request: CreateUserRequest) => {
    const created = await userService.createUser(request);
    await mutate(swrKeys.adminUsers());
    return created;
  };
}

/**
 * 更新用户启用/禁用状态（写操作）
 * 更新成功后刷新管理员用户列表。
 */
export function useUpdateUserStatus() {
  const { mutate } = useSWRConfig();

  return async (userId: string, request: UpdateUserStatusRequest) => {
    const updated = await userService.updateUserStatus(userId, request);
    await mutate(swrKeys.adminUsers());
    return updated;
  };
}


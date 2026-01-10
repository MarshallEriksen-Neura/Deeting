import { httpClient } from './client';
import { UserInfo } from './auth';

// 用户管理相关接口
export interface CreateUserRequest {
  email: string;
  password: string;
  display_name?: string;
  avatar?: string;
}

export interface UpdateUserRequest {
  email?: string;
  password?: string;
  display_name?: string;
  avatar?: string;
}

export interface UpdateUserStatusRequest {
  is_active: boolean;
}

export interface UserLookup {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
}

// 用户API服务
export const userService = {
  // 创建用户
  createUser: async (data: CreateUserRequest): Promise<UserInfo> => {
    const response = await httpClient.post('/users', data);
    return response.data;
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<UserInfo> => {
    const response = await httpClient.get('/users/me');
    return response.data;
  },

  // 更新用户信息
  updateUser: async (userId: string, data: UpdateUserRequest): Promise<UserInfo> => {
    const response = await httpClient.put(`/users/${userId}`, data);
    return response.data;
  },

  // 上传并更新当前用户头像
  uploadAvatar: async (file: File): Promise<UserInfo> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await httpClient.post('/users/me/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // 更新用户状态
  updateUserStatus: async (
    userId: string,
    data: UpdateUserStatusRequest
  ): Promise<UserInfo> => {
    const response = await httpClient.put(`/users/${userId}/status`, data);
    return response.data;
  },

  // 搜索用户（用于私有分享等场景）
  searchUsers: async (params: { q?: string; ids?: string[]; limit?: number } = {}): Promise<UserLookup[]> => {
    const searchParams = new URLSearchParams();
    if (params.q) {
      searchParams.set('q', params.q);
    }
    if (params.ids) {
      params.ids.filter(Boolean).forEach((id) => searchParams.append('ids', id));
    }
    if (params.limit) {
      searchParams.set('limit', String(params.limit));
    }
    if (!searchParams.has('q') && !searchParams.has('ids')) {
      throw new Error('searchUsers requires at least a keyword or user IDs');
    }
    const response = await httpClient.get('/users/search', { params: searchParams });
    return response.data;
  },
};

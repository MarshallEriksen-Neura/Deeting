import { httpClient } from './client';
import type {
  Conversation,
  CreateConversationRequest,
  UpdateConversationRequest,
  GetConversationsParams,
  ConversationsResponse,
} from '@/lib/api-types';
import {
  normalizeConversation,
  type ConversationBackend,
  type ConversationsResponseBackend,
} from '@/lib/normalizers/chat-normalizers';

/**
 * 会话管理服务
 */
export const conversationService = {
  /**
   * 获取会话列表（按 last_activity_at 倒序）
   */
  getConversations: async (params: GetConversationsParams): Promise<ConversationsResponse> => {
    const { data } = await httpClient.get<ConversationsResponseBackend>('/v1/conversations', { params });
    return {
      items: data.items.map(normalizeConversation),
      next_cursor: data.next_cursor,
    };
  },

  /**
   * 创建会话
   */
  createConversation: async (request: CreateConversationRequest): Promise<Conversation> => {
    const { data } = await httpClient.post<ConversationBackend>('/v1/conversations', request);
    return normalizeConversation(data);
  },

  /**
   * 更新会话（修改 title 或 archived 状态）
   */
  updateConversation: async (
    conversationId: string,
    request: UpdateConversationRequest
  ): Promise<Conversation> => {
    const { data } = await httpClient.put<ConversationBackend>(`/v1/conversations/${conversationId}`, request);
    return normalizeConversation(data);
  },

  /**
   * 删除会话（硬删除，级联删除所有消息、runs 和 evals）
   */
  deleteConversation: async (conversationId: string): Promise<void> => {
    await httpClient.delete(`/v1/conversations/${conversationId}`);
  },
};

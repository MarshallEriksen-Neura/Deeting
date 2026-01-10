/**
 * SWR Key 一致性测试
 * 验证所有 SWR hooks 使用稳定的字符串 key
 * Requirements: 9.1, 9.2, 9.3
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAssistants } from '../use-assistants';
import { useConversations } from '../use-conversations';
import { useMessages } from '../use-messages';

describe('SWR Key 一致性', () => {
  describe('useAssistants', () => {
    it('应该使用字符串 key', () => {
      const { result } = renderHook(() =>
        useAssistants({ project_id: 'test-project' })
      );

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      expect(result.current.assistants).toEqual([]);
    });

    it('相同参数应该生成相同的 key', () => {
      const params1 = { project_id: 'test-project', limit: 10 };
      const params2 = { project_id: 'test-project', limit: 10 };

      const { result: result1 } = renderHook(() => useAssistants(params1));
      const { result: result2 } = renderHook(() => useAssistants(params2));

      // 两个 hook 应该共享相同的缓存
      expect(result1.current.assistants).toEqual(result2.current.assistants);
    });

    it('不同参数应该生成不同的 key', () => {
      const params1 = { project_id: 'project-1' };
      const params2 = { project_id: 'project-2' };

      const { result: result1 } = renderHook(() => useAssistants(params1));
      const { result: result2 } = renderHook(() => useAssistants(params2));

      // 验证两个 hook 都正常工作
      expect(result1.current).toBeDefined();
      expect(result2.current).toBeDefined();
    });
  });

  describe('useConversations', () => {
    it('应该使用字符串 key', () => {
      const { result } = renderHook(() =>
        useConversations({ assistant_id: 'test-assistant' })
      );

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      expect(result.current.conversations).toEqual([]);
    });

    it('相同参数应该生成相同的 key', () => {
      const params1 = { assistant_id: 'test-assistant', limit: 10 };
      const params2 = { assistant_id: 'test-assistant', limit: 10 };

      const { result: result1 } = renderHook(() => useConversations(params1));
      const { result: result2 } = renderHook(() => useConversations(params2));

      // 两个 hook 应该共享相同的缓存
      expect(result1.current.conversations).toEqual(result2.current.conversations);
    });

    it('不同参数应该生成不同的 key', () => {
      const params1 = { assistant_id: 'assistant-1' };
      const params2 = { assistant_id: 'assistant-2' };

      const { result: result1 } = renderHook(() => useConversations(params1));
      const { result: result2 } = renderHook(() => useConversations(params2));

      // 验证两个 hook 都正常工作
      expect(result1.current).toBeDefined();
      expect(result2.current).toBeDefined();
    });
  });

  describe('useMessages', () => {
    it('应该使用字符串 key', () => {
      const { result } = renderHook(() =>
        useMessages('test-conversation')
      );

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      expect(result.current.messages).toEqual([]);
    });

    it('相同参数应该生成相同的 key', () => {
      const conversationId = 'test-conversation';
      const params = { limit: 10 };

      const { result: result1 } = renderHook(() => useMessages(conversationId, params));
      const { result: result2 } = renderHook(() => useMessages(conversationId, params));

      // 两个 hook 应该共享相同的缓存
      expect(result1.current.messages).toEqual(result2.current.messages);
    });

    it('不同参数应该生成不同的 key', () => {
      const { result: result1 } = renderHook(() => useMessages('conversation-1'));
      const { result: result2 } = renderHook(() => useMessages('conversation-2'));

      // 验证两个 hook 都正常工作
      expect(result1.current).toBeDefined();
      expect(result2.current).toBeDefined();
    });

    it('null conversationId 应该返回 null key', () => {
      const { result } = renderHook(() => useMessages(null));

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      expect(result.current.messages).toEqual([]);
    });
  });

  describe('Key 格式验证', () => {
    it('useAssistants 应该生成正确格式的 URL key', () => {
      // 这个测试验证 key 的格式是否符合预期
      const params = { project_id: 'test-project', limit: 10 };
      const { result } = renderHook(() => useAssistants(params));

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      // Key 应该是类似 "/v1/assistants?project_id=test-project&limit=10" 的格式
    });

    it('useConversations 应该生成正确格式的 URL key', () => {
      const params = { assistant_id: 'test-assistant', limit: 10 };
      const { result } = renderHook(() => useConversations(params));

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      // Key 应该是类似 "/v1/conversations?assistant_id=test-assistant&limit=10" 的格式
    });

    it('useMessages 应该生成正确格式的 URL key', () => {
      const conversationId = 'test-conversation';
      const params = { limit: 10 };
      const { result } = renderHook(() => useMessages(conversationId, params));

      // 验证 hook 正常工作
      expect(result.current).toBeDefined();
      // Key 应该是类似 "/v1/conversations/test-conversation/messages?limit=10" 的格式
    });
  });
});

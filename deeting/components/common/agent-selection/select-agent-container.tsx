'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { X, MessageSquare, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CreateAgentModal } from '@/components/assistants/create-agent-modal';
import { GlassButton } from '@/components/ui/glass-button';
import { GlassCard } from '@/components/ui/glass-card';
import { useChatService } from '@/hooks/use-chat-service';
import { useUserProfile } from '@/hooks/use-user';

/**
 * SelectAgentContainer Component
 * 
 * 助手选择容器组件，显示可用的助手列表并允许用户选择现有助手。
 * 
 * 功能：
 * - 显示已安装的助手（Tauri 模式）或云端助手（Web 模式）
 * - 支持编辑已有助手（如果用户是所有者）
 * 
 * 性能优化：
 * - 使用 React.useMemo 缓存计算结果
 * - 使用 React.useCallback 缓存事件处理函数
 */
export function SelectAgentContainer() {
  const router = useRouter();
  const t = useTranslations('assistants');
  const tCommon = useTranslations('common');
  const { profile } = useUserProfile();
  const { assistants: cloudAssistants, removeAssistantOptimistic } = useChatService({ enabled: true });

  // 使用 useMemo 缓存云端助手列表
  const cloudAgents = React.useMemo(
    () =>
      cloudAssistants.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        desc: assistant.desc,
        icon: "lucide:bot",
        tags: [],
        author: "system",
        ownerUserId: assistant.ownerUserId,
        installs: "",
        rating: 0,
        color: assistant.color,
        systemPrompt: assistant.systemPrompt,
      })),
    [cloudAssistants]
  );

  const displayAgents = cloudAgents;

  // 使用 useCallback 缓存事件处理函数
  const handleSelectAgent = React.useCallback(
    (assistantId: string) => {
      router.replace(`/chat/${encodeURIComponent(assistantId)}`);
    },
    [router]
  );

  const handleClose = React.useCallback(() => {
    router.replace("/chat");
  }, [router]);

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden ring-1 ring-white/5"
      >
        {/* Background Effects */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-purple-500/10 blur-[80px] rounded-full" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full" />

        <GlassButton
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleClose}
          className="absolute top-6 right-6 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10"
          aria-label={tCommon('gallery.detail.close')}
        >
          <X className="w-4 h-4" />
        </GlassButton>

        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">{t('select.title')}</h2>
        <p className="text-white/40 mb-8 font-light">{t('select.subtitle')}</p>

        <div className="grid grid-cols-2 gap-4">
          {displayAgents.map((agent) => {
            const canEdit =
              Boolean(agent.ownerUserId && profile?.id && agent.ownerUserId === profile.id);

            return (
          <AgentCard
            key={agent.id}
            icon={<MessageSquare className="w-6 h-6 text-blue-400" />}
            name={agent.name}
            desc={agent.desc ?? ''}
            onClick={() => handleSelectAgent(agent.id)}
            action={
                  canEdit ? (
                    <CreateAgentModal
                      mode="cloud"
                      assistant={{
                        id: agent.id,
                        name: agent.name,
                        desc: agent.desc ?? '',
                        systemPrompt: agent.systemPrompt ?? '',
                        tags: agent.tags ?? [],
                        iconId: agent.icon ?? 'lucide:bot',
                        color: agent.color,
                      }}
                      onUpdated={(assistantId) => {
                        // Refresh logic or just select it
                        handleSelectAgent(assistantId);
                      }}
                      onDeleted={(assistantId) => {
                        if (!assistantId) return
                        removeAssistantOptimistic(assistantId)
                        // 删除助手后不跳转，保持在当前页面
                      }}
                      trigger={
                        <GlassButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={t('edit.trigger')}
                        >
                          <Pencil className="w-4 h-4" />
                        </GlassButton>
                      }
                    />
                  ) : null
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  )
}

interface AgentCardProps {
  icon: React.ReactNode
  name: string
  desc: string
  onClick?: () => void
  action?: React.ReactNode
}

/**
 * AgentCard Component
 * 
 * 助手卡片组件，显示单个助手的信息。
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 */
const AgentCard = React.memo<AgentCardProps>(function AgentCard({ 
  icon, 
  name, 
  desc, 
  onClick, 
  action 
}) {
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  }, [onClick]);

  return (
    <GlassCard
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      blur="lg"
      theme="surface"
      hover="none"
      padding="sm"
      className="relative flex min-h-[120px] flex-col justify-between text-left cursor-pointer border-white/10 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:bg-white/8 hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {action ? <div className="absolute right-3 top-3 z-10">{action}</div> : null}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white/90">{name}</h3>
          <p className="mt-1 text-xs text-white/45 line-clamp-2">{desc}</p>
        </div>
      </div>
    </GlassCard>
  )
})

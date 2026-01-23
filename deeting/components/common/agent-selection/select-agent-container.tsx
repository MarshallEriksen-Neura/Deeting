'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { X, MessageSquare, Plus, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CreateAgentModal } from '@/components/assistants/create-agent-modal';
import { useMarketStore } from '@/store/market-store';
import { useChatService } from '@/hooks/use-chat-service';
import { useUserProfile } from '@/hooks/use-user';

/**
 * SelectAgentContainer Component
 * 
 * 助手选择容器组件，显示可用的助手列表并允许用户选择或创建助手。
 * 
 * 功能：
 * - 显示已安装的助手（Tauri 模式）或云端助手（Web 模式）
 * - 支持创建新助手
 * - 支持编辑已有助手（如果用户是所有者）
 * 
 * 性能优化：
 * - 使用 React.useMemo 缓存计算结果
 * - 使用 React.useCallback 缓存事件处理函数
 */
export function SelectAgentContainer() {
  const router = useRouter();
  const t = useTranslations('assistants');
  const installedAgents = useMarketStore((state) => state.installedAgents);
  const localAssistants = useMarketStore((state) => state.localAssistants);
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants);
  const loaded = useMarketStore((state) => state.loaded);
  const { profile } = useUserProfile();
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";
  const { assistants: cloudAssistants } = useChatService({ enabled: !isTauri });

  React.useEffect(() => {
    if (loaded || !isTauri) return;
    void loadLocalAssistants();
  }, [isTauri, loaded, loadLocalAssistants]);

  // 使用 useMemo 缓存助手映射
  const assistantMap = React.useMemo(
    () => (isTauri ? new Map(localAssistants.map((assistant) => [assistant.id, assistant])) : new Map()),
    [isTauri, localAssistants]
  );

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

  const displayAgents = isTauri ? installedAgents : cloudAgents;

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

  const handleCreateAgent = React.useCallback(() => {
    router.replace('/chat/create/assistant');
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

        <button 
          onClick={handleClose}
          className="absolute top-6 right-6 text-white/30 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">{t('select.title')}</h2>
        <p className="text-white/40 mb-8 font-light">{t('select.subtitle')}</p>

        <div className="grid grid-cols-2 gap-4">
          <AgentCard
            icon={<Plus className="w-6 h-6 text-emerald-400" />}
            name={t('select.create.name')}
            desc={t('select.create.desc')}
            onClick={handleCreateAgent}
          />
          {displayAgents.map((agent) => {
            const record = assistantMap.get(agent.id);
            // In Cloud mode, allow editing if current user is the owner
            const canEdit =
              isTauri || (agent.ownerUserId && profile?.id && agent.ownerUserId === profile.id);

            return (
              <AgentCard
                key={agent.id}
                icon={<MessageSquare className="w-6 h-6 text-blue-400" />}
                name={agent.name}
                desc={record?.description ?? agent.desc ?? ''}
                onClick={() => handleSelectAgent(agent.id)}
                action={
                  canEdit ? (
                    <CreateAgentModal
                      mode={isTauri ? "local" : "cloud"}
                      assistant={{
                        id: agent.id,
                        name: agent.name,
                        desc: record?.description ?? agent.desc ?? '',
                        systemPrompt: record?.system_prompt ?? agent.systemPrompt ?? '',
                        tags: record?.tags ?? agent.tags ?? [],
                        iconId: record?.avatar ?? agent.icon ?? 'lucide:bot',
                        color: agent.color,
                      }}
                      onUpdated={(assistantId) => {
                        // Refresh logic or just select it
                        handleSelectAgent(assistantId);
                      }}
                      onDeleted={handleClose}
                      trigger={
                        <button
                          type="button"
                          className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors flex items-center justify-center"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={t('edit.trigger')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
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
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="relative flex flex-col text-left p-5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 transition-all hover:scale-[1.01] hover:shadow-xl group cursor-pointer"
    >
      {action ? <div className="absolute top-4 right-4 z-10">{action}</div> : null}
      <div className="mb-4 p-3 bg-white/5 rounded-xl w-fit group-hover:bg-white/10 transition-colors shadow-inner">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-white/90">{name}</h3>
      <p className="text-sm text-white/50 leading-relaxed font-light">{desc}</p>
    </div>
  )
})

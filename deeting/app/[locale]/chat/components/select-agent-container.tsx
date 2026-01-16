'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { X, Code, PenTool, Sparkles, MessageSquare, Plus, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CreateAgentModal } from '@/components/assistants/create-agent-modal';
import { useMarketStore } from '@/store/market-store';
import { useChatService } from '@/hooks/use-chat-service';

export function SelectAgentContainer() {
  const router = useRouter();
  const t = useTranslations('assistants');
  const installedAgents = useMarketStore((state) => state.installedAgents);
  const localAssistants = useMarketStore((state) => state.localAssistants);
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants);
  const loaded = useMarketStore((state) => state.loaded);
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";
  const { assistants: cloudAssistants } = useChatService({ enabled: !isTauri });

  React.useEffect(() => {
    if (loaded || !isTauri) return;
    void loadLocalAssistants();
  }, [isTauri, loaded, loadLocalAssistants]);

  const assistantMap = React.useMemo(
    () => (isTauri ? new Map(localAssistants.map((assistant) => [assistant.id, assistant])) : new Map()),
    [isTauri, localAssistants]
  );

  const cloudAgents = React.useMemo(
    () =>
      cloudAssistants.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        desc: assistant.desc,
        icon: "lucide:bot",
        tags: [],
        author: "system",
        installs: "",
        rating: 0,
        color: assistant.color,
        systemPrompt: assistant.systemPrompt,
      })),
    [cloudAssistants]
  );

  const displayAgents = isTauri ? installedAgents : cloudAgents;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden ring-1 ring-white/5"
      >
        {/* Background Effects */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-purple-500/10 blur-[80px] rounded-full" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full" />

        <button 
          onClick={() => router.back()}
          className="absolute top-6 right-6 text-white/30 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Select Agent</h2>
        <p className="text-white/40 mb-8 font-light">Choose the specialized intelligence for your task.</p>

        <div className="grid grid-cols-2 gap-4">
          <CreateAgentModal
            mode="local"
            onCreated={(assistantId) => {
              if (assistantId) {
                router.replace(`/chat/${assistantId}`)
              }
            }}
            trigger={
              <AgentCard
                icon={<Plus className="w-6 h-6 text-emerald-400" />}
                name="Create"
                desc="Build your own assistant. Private by default."
              />
            }
          />
          {displayAgents.map((agent) => {
            const record = assistantMap.get(agent.id);
            return (
              <AgentCard
                key={agent.id}
                icon={<MessageSquare className="w-6 h-6 text-blue-400" />}
                name={agent.name}
                desc={record?.description ?? agent.desc ?? ''}
                onClick={() => router.replace(`/chat/${agent.id}`)}
                action={
                  <CreateAgentModal
                    mode="local"
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
                      router.replace(`/chat/${assistantId}`);
                    }}
                    onDeleted={() => {
                      router.replace('/chat/select-agent');
                    }}
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
                }
              />
            );
          })}
          <AgentCard 
            icon={<Code className="w-6 h-6 text-green-400" />} 
            name="Coder" 
            desc="Python, JS, Rust expert. Capabilities: Execution, Debugging." 
            onClick={() => router.replace('/chat/coder')} 
          />
          <AgentCard 
            icon={<Sparkles className="w-6 h-6 text-purple-400" />}
            name="Artist"
            desc="DALL-E 3, Stable Diffusion. Visual creation & editing."
            onClick={() => router.replace('/chat/create/image')}
          />
          <AgentCard 
            icon={<PenTool className="w-6 h-6 text-orange-400" />}
            name="Writer"
            desc="Creative writing, copy, storytelling. Long-form focus."
             onClick={() => router.back()} // Placeholder
          />
          <AgentCard 
             icon={<MessageSquare className="w-6 h-6 text-blue-400" />}
             name="Assistant"
             desc="General purpose helper. Analysis, planning, chat."
             onClick={() => router.replace('/chat')}
          />
        </div>
      </div>
    </div>
  )
}

function AgentCard({ icon, name, desc, onClick, action }: any) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

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
}

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Search, MessageSquare, Clock, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfiniteList } from '@/components/ui/infinite-list';
import { useConversationSessions } from '@/lib/swr/use-conversation-sessions';
import { useI18n } from '@/hooks/use-i18n';
import { useChatStore } from '@/store/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { ConversationSessionItem } from '@/lib/api/conversations';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HistorySidebar({ isOpen, onClose }: HistorySidebarProps) {
  const t = useI18n('chat');
  const [search, setSearch] = useState('');
  const {
    activeAssistantId,
    sessionId,
    loadHistoryBySession,
    resetSession,
  } = useChatStore(
    useShallow((state) => ({
      activeAssistantId: state.activeAssistantId,
      sessionId: state.sessionId,
      loadHistoryBySession: state.loadHistoryBySession,
      resetSession: state.resetSession,
    }))
  );

  const {
    items,
    hasMore,
    isLoadingMore,
    error,
    loadMore,
    reset,
  } = useConversationSessions(
    { size: 24, assistant_id: activeAssistantId ?? undefined },
    { enabled: Boolean(activeAssistantId) }
  );

  const searchValue = search.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    if (!searchValue) return items;
    return items.filter((session) => {
      const target =
        session.title?.trim() ||
        session.summary_text?.trim() ||
        session.session_id;
      return target.toLowerCase().includes(searchValue);
    });
  }, [items, searchValue]);

  const historyGroups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfLast7Days = new Date(startOfToday);
    startOfLast7Days.setDate(startOfLast7Days.getDate() - 7);

    const labels = {
      today: t('history.groups.today'),
      yesterday: t('history.groups.yesterday'),
      last7Days: t('history.groups.last7Days'),
      earlier: t('history.groups.earlier'),
    };

    const resolveGroupLabel = (session: ConversationSessionItem) => {
      const rawDate = session.last_active_at ?? session.first_message_at;
      if (!rawDate) return labels.earlier;
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) return labels.earlier;
      if (date >= startOfToday) return labels.today;
      if (date >= startOfYesterday) return labels.yesterday;
      if (date >= startOfLast7Days) return labels.last7Days;
      return labels.earlier;
    };

    const buckets = new Map<string, ConversationSessionItem[]>();
    filteredSessions.forEach((session) => {
      const label = resolveGroupLabel(session);
      const bucket = buckets.get(label) ?? [];
      bucket.push(session);
      buckets.set(label, bucket);
    });

    return [labels.today, labels.yesterday, labels.last7Days, labels.earlier]
      .map((label) => {
        const groupItems = buckets.get(label) ?? [];
        return groupItems.length ? { label, items: groupItems } : null;
      })
      .filter(Boolean) as Array<{ label: string; items: ConversationSessionItem[] }>;
  }, [filteredSessions, t]);

  const handleSelectSession = async (targetSessionId: string) => {
    await loadHistoryBySession(targetSessionId);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (Click to close) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-[2px]"
          />

          {/* Sidebar Panel */}
          <motion.div
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-4 bottom-4 left-4 w-80 z-[70] flex flex-col"
          >
            {/* Glass Container */}
            <div className="h-full w-full bg-white/80 dark:bg-[#121212]/90 backdrop-blur-2xl border border-black/5 dark:border-white/5 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              
              {/* Header */}
              <div className="p-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-bold text-black/80 dark:text-white/80 tracking-wide">{t('history.title')}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
                  onClick={() => {
                    resetSession();
                    onClose();
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Search */}
              <div className="px-4 py-2">
                <div className="relative group">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-black/30 dark:text-white/30 group-hover:text-black/50 dark:group-hover:text-white/50 transition-colors" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('history.searchPlaceholder')}
                    className="w-full bg-black/5 dark:bg-white/5 border border-transparent focus:border-black/10 dark:focus:border-white/10 rounded-xl py-2 pl-9 pr-3 text-sm outline-none transition-all placeholder:text-black/30 dark:placeholder:text-white/30 text-black/80 dark:text-white/80"
                  />
                </div>
              </div>

              {/* Scrollable List */}
              <div className="flex-1 overflow-hidden px-2 pb-2">
                <InfiniteList
                  className="h-full"
                  isLoading={isLoadingMore}
                  isError={Boolean(error)}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  emptyDisplay={
                    <div className="flex flex-col items-center gap-2 text-black/40 dark:text-white/40">
                      <MessageSquare className="h-9 w-9 opacity-50" />
                      <p className="text-sm font-medium">{t('history.emptyTitle')}</p>
                      <p className="text-xs">{t('history.emptyDesc')}</p>
                    </div>
                  }
                  loadingIndicator={
                    <div className="flex items-center gap-2 text-black/40 dark:text-white/40 text-xs">
                      <span>{t('history.loading')}</span>
                    </div>
                  }
                  errorDisplay={
                    <div className="flex flex-col items-center gap-2 text-red-500">
                      <span className="text-xs">{t('history.loadFailed')}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => reset()}
                      >
                        {t('history.retry')}
                      </Button>
                    </div>
                  }
                  noMoreDisplay={<span>{t('history.noMore')}</span>}
                >
                  {historyGroups.length > 0 ? (
                    <div className="space-y-6 py-2">
                      {historyGroups.map((group) => (
                        <div key={group.label} className="px-2">
                          <h3 className="text-[10px] font-bold text-black/30 dark:text-white/30 uppercase tracking-wider mb-2 px-2">
                            {group.label}
                          </h3>
                          <div className="space-y-1">
                            {group.items.map((session) => {
                              const title =
                                session.title?.trim() ||
                                session.summary_text?.trim() ||
                                t('history.untitled');
                              const isActive = sessionId === session.session_id;
                              return (
                                <Button
                                  key={session.session_id}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSelectSession(session.session_id)}
                                  className={cn(
                                    "w-full justify-start gap-3 rounded-lg px-2 py-2 text-left transition-all",
                                    "hover:bg-black/5 dark:hover:bg-white/5",
                                    isActive && "bg-black/5 dark:bg-white/5"
                                  )}
                                >
                                  <MessageSquare className="w-4 h-4 text-black/40 dark:text-white/40 shrink-0" />
                                  <span className="text-sm text-black/70 dark:text-white/70 truncate flex-1 font-medium">
                                    {title}
                                  </span>
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </InfiniteList>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full flex items-center justify-center gap-2 text-xs font-medium text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                >
                  <Clock className="w-3 h-3" />
                  {t('history.viewArchived')}
                </Button>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

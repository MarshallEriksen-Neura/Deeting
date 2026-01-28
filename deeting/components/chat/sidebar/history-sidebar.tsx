'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  MessageSquare,
  Clock,
  Plus,
  MoreHorizontal,
  Archive,
  RotateCcw,
  PencilLine,
} from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfiniteList } from '@/components/ui/infinite-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useConversationSessions } from '@/lib/swr/use-conversation-sessions';
import { archiveConversation, createConversation, unarchiveConversation, renameConversation } from '@/lib/api/conversations';
import { useI18n } from '@/hooks/use-i18n';
import { useChatStateStore } from '@/store/chat-state-store';
import { useChatSessionStore } from '@/store/chat-session-store';
import { useChatMessagingService } from '@/hooks/chat/use-chat-messaging-service';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { ConversationSessionItem } from '@/lib/api/conversations';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HistorySidebar({ isOpen, onClose }: HistorySidebarProps) {
  const t = useI18n('chat');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [actionSessionId, setActionSessionId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  
  const { activeAssistantId, setMessages, clearAttachments } = useChatStateStore(
    useShallow((state) => ({
      activeAssistantId: state.activeAssistantId,
      setMessages: state.setMessages,
      clearAttachments: state.clearAttachments,
    }))
  );

  const { sessionId, resetSession, setSessionId, setGlobalLoading } = useChatSessionStore(
    useShallow((state) => ({
      sessionId: state.sessionId,
      resetSession: state.resetSession,
      setSessionId: state.setSessionId,
      setGlobalLoading: state.setGlobalLoading,
    }))
  );

  const { loadHistoryBySession } = useChatMessagingService();

  const {
    items,
    hasMore,
    isLoadingMore,
    error,
    loadMore,
    reset,
    mutate,
  } = useConversationSessions(
    {
      size: 24,
      assistant_id: activeAssistantId ?? undefined,
      status: showArchived ? "archived" : "active",
    },
    { enabled: Boolean(activeAssistantId) }
  );

  useEffect(() => {
    reset();
    setSearch('');
  }, [reset, activeAssistantId, showArchived]);

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

  const buildChatUrl = useCallback((nextSessionId?: string) => {
    const basePath = activeAssistantId ? `/chat/${activeAssistantId}` : "/chat";
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("agentId");
    if (nextSessionId) {
      params.set("session", nextSessionId);
    } else {
      params.delete("session");
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }, [activeAssistantId, searchParams]);

  const handleSelectSession = useCallback(async (targetSessionId: string) => {
    await loadHistoryBySession(targetSessionId);
    router.replace(buildChatUrl(targetSessionId));
    onClose();
  }, [loadHistoryBySession, router, buildChatUrl, onClose]);

  const handleResetSession = useCallback(async () => {
    resetSession();
    setMessages([]);
    clearAttachments();
    if (typeof window !== "undefined" && activeAssistantId) {
      localStorage.removeItem(`deeting-chat-session:${activeAssistantId}`);
    }
    setGlobalLoading(true);
    try {
      const created = await createConversation({
        assistant_id: activeAssistantId ?? null,
      });
      if (created.session_id) {
        setSessionId(created.session_id);
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(searchParams?.toString());
          params.set("session", created.session_id);
          params.delete("agentId");
          const basePath = activeAssistantId ? `/chat/${activeAssistantId}` : "/chat";
          const query = params.toString();
          const nextUrl = query ? `${basePath}?${query}` : basePath;
          window.history.replaceState(null, "", nextUrl);
        }
        return;
      }
    } catch (error) {
      console.warn("create_conversation_failed", error);
    } finally {
      setGlobalLoading(false);
    }
    if (typeof window !== "undefined") {
      const fallbackUrl = buildChatUrl();
      window.history.replaceState(null, "", fallbackUrl);
    } else {
      router.replace(buildChatUrl());
    }
  }, [
    resetSession,
    setMessages,
    clearAttachments,
    activeAssistantId,
    searchParams,
    setSessionId,
    setGlobalLoading,
    buildChatUrl,
    router,
  ]);

  const handleArchiveToggle = useCallback(async (
    targetSessionId: string,
    nextStatus: "archived" | "active"
  ) => {
    if (actionSessionId) return;
    setActionSessionId(targetSessionId);
    try {
      if (nextStatus === "archived") {
        await archiveConversation(targetSessionId);
      } else {
        await unarchiveConversation(targetSessionId);
      }
      await mutate();
    } finally {
      setActionSessionId(null);
    }
  }, [actionSessionId, mutate]);

  const openRenameDialog = useCallback((session: ConversationSessionItem) => {
    const initialTitle =
      session.title?.trim() || session.summary_text?.trim() || '';
    setRenameSessionId(session.session_id);
    setRenameValue(initialTitle);
    setRenameError(null);
    setRenameOpen(true);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameSessionId) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      setRenameError(t('history.renameEmpty'));
      return;
    }
    if (renameSaving) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await renameConversation(renameSessionId, nextTitle);
      await mutate();
      setRenameOpen(false);
    } catch {
      setRenameError(t('history.renameFailed'));
    } finally {
      setRenameSaving(false);
    }
  }, [renameSessionId, renameValue, renameSaving, t, mutate]);

  const handleRenameOpenChange = useCallback((open: boolean) => {
    setRenameOpen(open);
    if (!open) {
      setRenameSessionId(null);
      setRenameValue('');
      setRenameError(null);
      setRenameSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setRenameOpen(false);
      setRenameSessionId(null);
      setRenameValue('');
      setRenameError(null);
      setRenameSaving(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void mutate();
  }, [isOpen, mutate]);

  const handleToggleArchived = useCallback(() => {
    setShowArchived((prev) => !prev);
  }, []);

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
            <div className="h-full w-full bg-white/92 dark:bg-[#121212]/90 backdrop-blur-2xl border border-slate-200/70 dark:border-white/5 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              
              {/* Header */}
              <div className="p-4 border-b border-slate-200/70 dark:border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white/80 tracking-wide">{t('history.title')}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-slate-600 dark:text-white/50 hover:text-slate-900 dark:hover:text-white"
                  onClick={() => {
                    handleResetSession();
                    onClose();
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Search */}
              <div className="px-4 py-2">
                <div className="relative group">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 dark:text-white/30 group-hover:text-slate-600 dark:group-hover:text-white/50 transition-colors" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('history.searchPlaceholder')}
                    className="w-full bg-slate-100/80 dark:bg-white/5 border border-transparent focus:border-slate-200 dark:focus:border-white/10 rounded-xl py-2 pl-9 pr-3 text-sm outline-none transition-all placeholder:text-slate-500 dark:placeholder:text-white/30 text-slate-800 dark:text-white/80"
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
                    <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-white/40">
                      <MessageSquare className="h-9 w-9 opacity-50" />
                      <p className="text-sm font-medium">{t('history.emptyTitle')}</p>
                      <p className="text-xs">{t('history.emptyDesc')}</p>
                    </div>
                  }
                  loadingIndicator={
                    <div className="flex items-center gap-2 text-slate-500 dark:text-white/40 text-xs">
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
                          <h3 className="text-[10px] font-bold text-slate-500 dark:text-white/30 uppercase tracking-wider mb-2 px-2">
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
                                <div key={session.session_id} className="group flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSelectSession(session.session_id)}
                                    className={cn(
                                      "flex-1 justify-start gap-3 rounded-lg px-2 py-2 text-left transition-all",
                                      "hover:bg-slate-100/80 dark:hover:bg-white/5",
                                      isActive && "bg-slate-100/80 dark:bg-white/5"
                                    )}
                                  >
                                    <MessageSquare className="w-4 h-4 text-slate-500 dark:text-white/40 shrink-0" />
                                    <span className="text-sm text-slate-700 dark:text-white/70 truncate flex-1 font-medium">
                                      {title}
                                    </span>
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="opacity-0 group-hover:opacity-100 text-slate-500 dark:text-white/40 hover:text-slate-900 dark:hover:text-white"
                                      >
                                        <MoreHorizontal className="w-4 h-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-36">
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          openRenameDialog(session);
                                        }}
                                      >
                                        <PencilLine className="mr-2 h-4 w-4" />
                                        {t('history.rename')}
                                      </DropdownMenuItem>
                                      {showArchived ? (
                                        <DropdownMenuItem
                                          onSelect={(event) => {
                                            event.preventDefault();
                                            void handleArchiveToggle(session.session_id, "active");
                                          }}
                                          disabled={actionSessionId === session.session_id}
                                        >
                                          <RotateCcw className="mr-2 h-4 w-4" />
                                          {t('history.unarchive')}
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem
                                          onSelect={(event) => {
                                            event.preventDefault();
                                            void handleArchiveToggle(session.session_id, "archived");
                                          }}
                                          disabled={actionSessionId === session.session_id}
                                        >
                                          <Archive className="mr-2 h-4 w-4" />
                                          {t('history.archive')}
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
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
              <div className="p-4 border-t border-slate-200/70 dark:border-white/5 bg-slate-50/80 dark:bg-white/[0.02]">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full flex items-center justify-center gap-2 text-xs font-medium text-slate-600 dark:text-white/40 hover:text-slate-900 dark:hover:text-white"
                  onClick={handleToggleArchived}
                >
                  <Clock className="w-3 h-3" />
                  {showArchived ? t('history.viewActive') : t('history.viewArchived')}
                </Button>
              </div>

            </div>
          </motion.div>

          <Dialog open={renameOpen} onOpenChange={handleRenameOpenChange}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('history.renameTitle')}</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRenameSubmit();
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="conversation-rename-input">
                    {t('history.renameLabel')}
                  </Label>
                  <Input
                    id="conversation-rename-input"
                    value={renameValue}
                    onChange={(event) => {
                      setRenameValue(event.target.value);
                      if (renameError) {
                        setRenameError(null);
                      }
                    }}
                    placeholder={t('history.renamePlaceholder')}
                  />
                  {renameError ? (
                    <p className="text-xs text-red-500">{renameError}</p>
                  ) : null}
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleRenameOpenChange(false)}
                  >
                    {t('history.renameCancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={renameSaving || !renameValue.trim()}
                  >
                    {renameSaving ? t('history.renameSaving') : t('history.renameConfirm')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </AnimatePresence>
  );
}

'use client';

import {
  Search,
  MessageSquare,
  Clock,
  Plus,
  MoreHorizontal,
  Archive,
  RotateCcw,
  PencilLine,
  Pin,
  PinOff,
} from 'lucide-react';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { InfiniteList } from '@/ui/common/infinite-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Label } from '@/ui/shadcn/label';
import { useConversationSessions } from '@/lib/swr/use-conversation-sessions';
import { archiveConversation, createConversation, unarchiveConversation, renameConversation, pinConversation, unpinConversation } from '@/lib/api/conversations';
import { useI18n } from '@/hooks/use-i18n';
import { useChatStore } from '@/store/chat-store';
import { useChatRuntimeStore } from '@/store/chat-runtime-store';
import { useChatMessagingService } from '@/hooks/chat/use-chat-messaging-service';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { ConversationSessionItem } from '@/lib/api/conversations';

interface HistorySidebarProps {
  className?: string;
}

export function HistorySidebar({ className }: HistorySidebarProps) {
  const t = useI18n('chat');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [actionSessionId, setActionSessionId] = useState<string | null>(null);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const suppressFreshMenuSelectUntilRef = useRef(0);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  
  const { setMessages, clearAttachments } = useChatStore(
    useShallow((state) => ({
      setMessages: state.setMessages,
      clearAttachments: state.clearAttachments,
    }))
  );
  const { sessionId, resetSession, setSessionId, setGlobalLoading } = useChatRuntimeStore(
    useShallow((state) => ({
      sessionId: state.sessionId,
      resetSession: state.resetSession,
      setSessionId: state.setSessionId,
      setGlobalLoading: state.setGlobalLoading,
    }))
  );
  const isGenerating = useChatRuntimeStore((state) => state.isLoading || state.activeMessageId !== null);

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
      status: showArchived ? "archived" : "active",
    },
    { enabled: true }
  );

  useEffect(() => {
    reset();
    setSearch('');
  }, [reset, showArchived]);

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
    const basePath = "/chat";
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("agentId");
    if (nextSessionId) {
      params.set("session", nextSessionId);
    } else {
      params.delete("session");
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }, [searchParams]);

  const handleSelectSession = useCallback(async (targetSessionId: string) => {
    // 从当前列表中查找目标会话的标题并同步到 store
    const targetSession = items.find((s) => s.session_id === targetSessionId);
    if (targetSession) {
      const title = targetSession.title?.trim() || targetSession.summary_text?.trim() || null;
      useChatRuntimeStore.getState().setSessionTitle(title);
    }
    await loadHistoryBySession(targetSessionId);
    router.replace(buildChatUrl(targetSessionId));
  }, [loadHistoryBySession, router, buildChatUrl, items]);

  const handleResetSession = useCallback(async () => {
    resetSession();
    setMessages([]);
    clearAttachments();
    setGlobalLoading(true);
    useChatRuntimeStore.getState().setSessionTitle(null);
    try {
      const created = await createConversation({});
      if (created.session_id) {
        setSessionId(created.session_id);
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(searchParams?.toString());
          params.set("session", created.session_id);
          params.delete("agentId");
          const basePath = "/chat";
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

  const handlePinToggle = useCallback(async (
    targetSessionId: string,
    isPinned: boolean
  ) => {
    if (actionSessionId) return;
    setActionSessionId(targetSessionId);
    try {
      if (isPinned) {
        await unpinConversation(targetSessionId);
      } else {
        await pinConversation(targetSessionId);
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
      // 如果重命名的是当前正在查看的会话，同步更新运行时 store 中的标题
      if (renameSessionId === sessionId) {
        useChatRuntimeStore.getState().setSessionTitle(nextTitle);
      }
      setRenameOpen(false);
    } catch {
      setRenameError(t('history.renameFailed'));
    } finally {
      setRenameSaving(false);
    }
  }, [renameSessionId, renameValue, renameSaving, t, mutate, sessionId]);

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
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsDocumentVisible(visible);
      if (visible) {
        void mutate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [mutate]);

  useEffect(() => {
    if (!isDocumentVisible) return;
    void mutate();
    const refreshIntervalMs = isGenerating ? 3000 : 12000;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void mutate();
    }, refreshIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [isDocumentVisible, isGenerating, mutate]);

  const handleToggleArchived = useCallback(() => {
    setShowArchived((prev) => !prev);
  }, []);

  const armFreshMenuSelectGuard = useCallback(() => {
    suppressFreshMenuSelectUntilRef.current = Date.now() + 350;
  }, []);

  const shouldSuppressFreshMenuSelect = useCallback(() => {
    return Date.now() < suppressFreshMenuSelectUntilRef.current;
  }, []);

  return (
    <>
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
        <div className="px-4 pb-3 pt-1">
          <h2 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-white/80">
            {t('history.title')}
          </h2>
        </div>

        <div className="px-4 pb-3">
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full justify-start gap-2 rounded-2xl border border-slate-200/70 bg-white/60 px-3 text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-colors hover:bg-white/90 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={() => {
              void handleResetSession();
            }}
          >
            <Plus className="h-4 w-4" />
            {t('header.newChat')}
          </Button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative group">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-600 dark:text-white/30 dark:group-hover:text-white/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('history.searchPlaceholder')}
              className="w-full rounded-2xl border border-transparent bg-slate-100/75 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-500 focus:border-slate-200 dark:bg-white/5 dark:text-white/80 dark:placeholder:text-white/30 dark:focus:border-white/10"
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
                                <div key={session.session_id} className="group/session flex items-center gap-1 w-full overflow-hidden">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSelectSession(session.session_id)}
                                    className={cn(
                                      "min-w-0 flex-1 justify-start gap-3 rounded-lg px-2 py-2 text-left transition-all overflow-hidden",
                                      "hover:bg-slate-100/80 dark:hover:bg-white/5",
                                      isActive && "bg-slate-100/80 dark:bg-white/5"
                                    )}
                                  >
                                    <MessageSquare className="w-4 h-4 text-slate-500 dark:text-white/40 shrink-0" />
                                    <span className="text-sm text-slate-700 dark:text-white/70 truncate flex-1 font-medium">
                                      {title}
                                    </span>
                                    {session.is_pinned && (
                                      <Pin className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
                                    )}
                                  </Button>
                                  <DropdownMenu
                                    open={openMenuSessionId === session.session_id}
                                    onOpenChange={(open) => {
                                      if (open) {
                                        armFreshMenuSelectGuard();
                                      }
                                      setOpenMenuSessionId(open ? session.session_id : null);
                                    }}
                                  >
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-white/40 dark:hover:text-white/70 dark:hover:bg-white/10 transition-colors"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          armFreshMenuSelectGuard();
                                          setOpenMenuSessionId((current) =>
                                            current === session.session_id ? null : session.session_id
                                          );
                                        }}
                                        onPointerDown={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          armFreshMenuSelectGuard();
                                        }}
                                      >
                                        <MoreHorizontal className="w-4 h-4" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" sideOffset={8} className="w-36">
                                      <DropdownMenuItem
                                        onSelect={(event) => {
                                          if (shouldSuppressFreshMenuSelect()) {
                                            event.preventDefault();
                                            return;
                                          }
                                          setOpenMenuSessionId(null);
                                          openRenameDialog(session);
                                        }}
                                      >
                                        <PencilLine className="mr-2 h-4 w-4" />
                                        {t('history.rename')}
                                      </DropdownMenuItem>
                                      {!showArchived && (
                                        <DropdownMenuItem
                                          onSelect={(event) => {
                                            if (shouldSuppressFreshMenuSelect()) {
                                              event.preventDefault();
                                              return;
                                            }
                                            event.preventDefault();
                                            void handlePinToggle(session.session_id, session.is_pinned || false);
                                          }}
                                          disabled={actionSessionId === session.session_id}
                                        >
                                          {session.is_pinned ? (
                                            <>
                                              <PinOff className="mr-2 h-4 w-4" />
                                              {t('history.unpin')}
                                            </>
                                          ) : (
                                            <>
                                              <Pin className="mr-2 h-4 w-4" />
                                              {t('history.pin')}
                                            </>
                                          )}
                                        </DropdownMenuItem>
                                      )}
                                      {showArchived ? (
                                        <DropdownMenuItem
                                          onSelect={(event) => {
                                            if (shouldSuppressFreshMenuSelect()) {
                                              event.preventDefault();
                                              return;
                                            }
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
                                            if (shouldSuppressFreshMenuSelect()) {
                                              event.preventDefault();
                                              return;
                                            }
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
  );
}

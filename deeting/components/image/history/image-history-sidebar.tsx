'use client';

import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Image as ImageIcon, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useImageGenerationTasks } from '@/lib/swr/use-image-generation-tasks';
import { useLazyImage } from '@/hooks/use-lazy-image';
import { cn } from '@/lib/utils';
import type { ImageGenerationTaskItem } from '@/lib/api/image-generation';
import { formatRelativeTime } from '@/lib/api/api-keys';

interface ImageHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type StatusTone = "default" | "secondary" | "destructive" | "outline";
type SessionGroup = {
  id: string;
  sessionId: string | null;
  tasks: ImageGenerationTaskItem[];
  latestTask: ImageGenerationTaskItem;
  latestAt: string | null;
  previewUrl: string | null;
  searchText: string;
  count: number;
};

/**
 * 懒加载图片组件
 * 使用 Intersection Observer 实现图片懒加载
 */
const LazyImage = memo<{
  src: string;
  alt: string;
  className?: string;
}>(({ src, alt, className }) => {
  const { imageSrc, isLoading, error, imgRef } = useLazyImage({
    src,
    rootMargin: '50px',
    threshold: 0.01,
  });

  return (
    <>
      <img
        ref={imgRef}
        src={imageSrc ?? undefined}
        alt={alt}
        className={cn(
          "object-cover w-full h-full transition-opacity",
          (isLoading || !imageSrc || error) && "opacity-0",
          className
        )}
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-white/30">
          <ImageIcon className="h-5 w-5" />
        </div>
      ) : null}
      {!error && (isLoading || !imageSrc) ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-white/5">
          <div className="w-5 h-5 border-2 border-slate-300 dark:border-white/20 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : null}
    </>
  );
});

LazyImage.displayName = 'LazyImage';

/**
 * 会话预览卡片组件
 * 使用 React.memo 优化渲染性能
 */
const SessionCard = memo<{
  session: SessionGroup;
  statusMeta: {
    labels: Record<string, string>;
    tones: Record<string, StatusTone>;
  };
  imageAlt: string;
  onSelect: (session: SessionGroup) => void;
  renderPrompt: (task: ImageGenerationTaskItem) => string;
}>(({ session, statusMeta, imageAlt, onSelect, renderPrompt }) => {
  const t = useI18n('chat');
  const task = session.latestTask;
  const statusLabel = statusMeta.labels[task.status] ?? task.status;
  const statusTone = statusMeta.tones[task.status] ?? "outline";

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onSelect(session)}
      className={cn(
        "w-full rounded-2xl px-4 py-3.5 flex items-center justify-start gap-4 text-left whitespace-normal",
        "bg-white/70 dark:bg-white/[0.03] hover:bg-white/90 dark:hover:bg-white/10",
        "border border-slate-200/60 dark:border-white/5"
      )}
    >
      <div className="relative w-24 aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 dark:bg-white/5 shrink-0 self-start mt-0.5">
        {session.previewUrl ? (
          <LazyImage
            src={session.previewUrl}
            alt={imageAlt}
            className="object-contain object-center"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-white/30">
            <ImageIcon className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 max-w-full flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusTone}>{statusLabel}</Badge>
          <span className="text-[10px] text-slate-400 dark:text-white/30">
            {formatRelativeTime(session.latestAt)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-white/30">
            {t("imageHistory.sessionCount", { count: session.count })}
          </span>
        </div>
        <span className="text-xs text-slate-700 dark:text-white/70 line-clamp-2 break-words">
          {renderPrompt(task)}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-white/30 truncate">
          {task.model}
        </span>
      </div>
    </Button>
  );
});

SessionCard.displayName = 'SessionCard';

/**
 * 图像历史侧边栏组件
 * 
 * 功能：
 * - 显示图像生成历史
 * - 按会话分组
 * - 搜索和过滤
 * - 无限滚动加载
 * 
 * 性能优化：
 * - 使用 React.memo 优化子组件
 * - 使用 useMemo 缓存计算结果
 * - 使用 useCallback 缓存事件处理函数
 * - 图片懒加载优化加载性能
 */
export function ImageHistorySidebar({ isOpen, onClose }: ImageHistorySidebarProps) {
  const t = useI18n('chat');
  const [search, setSearch] = useState('');
  const [selectedTask, setSelectedTask] = useState<ImageGenerationTaskItem | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const {
    items,
    hasMore,
    isLoadingMore,
    error,
    loadMore,
    reset,
  } = useImageGenerationTasks(
    { size: 24, include_outputs: true },
    { enabled: isOpen }
  );

  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedTask(null);
    }
  }, [isOpen]);

  // 使用 useMemo 缓存状态元数据
  const statusMeta = useMemo(() => {
    const labels = {
      queued: t('imageHistory.status.queued'),
      running: t('imageHistory.status.running'),
      succeeded: t('imageHistory.status.succeeded'),
      failed: t('imageHistory.status.failed'),
      canceled: t('imageHistory.status.canceled'),
    };
    const tones: Record<string, StatusTone> = {
      queued: "secondary",
      running: "secondary",
      succeeded: "default",
      failed: "destructive",
      canceled: "outline",
    };
    return { labels, tones };
  }, [t]);

  // 使用 useCallback 缓存时间戳解析函数
  const resolveTaskTimestamp = useCallback((task: ImageGenerationTaskItem) =>
    task.completed_at ?? task.updated_at ?? task.created_at ?? null,
    []
  );

  const resolveTaskTimestampValue = useCallback((task: ImageGenerationTaskItem) => {
    const timestamp = resolveTaskTimestamp(task);
    if (!timestamp) return 0;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }, [resolveTaskTimestamp]);

  // 使用 useMemo 缓存会话分组
  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const groupMap = new Map<string, { sessionId: string | null; tasks: ImageGenerationTaskItem[] }>();
    items.forEach((task) => {
      const sessionId = task.session_id ?? null;
      const key = sessionId ?? `task:${task.task_id}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.tasks.push(task);
      } else {
        groupMap.set(key, { sessionId, tasks: [task] });
      }
    });

    return Array.from(groupMap.entries()).map(([id, group]) => {
      const tasksSorted = [...group.tasks].sort(
        (a, b) => resolveTaskTimestampValue(b) - resolveTaskTimestampValue(a)
      );
      const latestTask = tasksSorted[0];
      const previewTask =
        tasksSorted.find((task) => task.preview?.asset_url || task.preview?.source_url) ??
        latestTask;
      const previewUrl = previewTask?.preview?.asset_url ?? previewTask?.preview?.source_url ?? null;
      const searchText = group.tasks
        .map((task) => [
          task.prompt_encrypted ? "" : task.prompt ?? "",
          task.model ?? "",
          task.status ?? "",
        ])
        .join(" ")
        .toLowerCase();

      return {
        id,
        sessionId: group.sessionId,
        tasks: group.tasks,
        latestTask,
        latestAt: resolveTaskTimestamp(latestTask),
        previewUrl,
        searchText,
        count: group.tasks.length,
      };
    });
  }, [items, resolveTaskTimestamp, resolveTaskTimestampValue]);

  const searchValue = search.trim().toLowerCase();
  
  // 使用 useMemo 缓存过滤结果
  const filteredGroups = useMemo(() => {
    if (!searchValue) return sessionGroups;
    return sessionGroups.filter((group) => group.searchText.includes(searchValue));
  }, [searchValue, sessionGroups]);

  // 使用 useMemo 缓存历史分组
  const historyGroups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfLast7Days = new Date(startOfToday);
    startOfLast7Days.setDate(startOfLast7Days.getDate() - 7);

    const labels = {
      today: t('imageHistory.groups.today'),
      yesterday: t('imageHistory.groups.yesterday'),
      last7Days: t('imageHistory.groups.last7Days'),
      earlier: t('imageHistory.groups.earlier'),
    };

    const resolveGroupLabel = (group: SessionGroup) => {
      const rawDate = group.latestAt;
      if (!rawDate) return labels.earlier;
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) return labels.earlier;
      if (date >= startOfToday) return labels.today;
      if (date >= startOfYesterday) return labels.yesterday;
      if (date >= startOfLast7Days) return labels.last7Days;
      return labels.earlier;
    };

    const buckets = new Map<string, SessionGroup[]>();
    filteredGroups.forEach((group) => {
      const label = resolveGroupLabel(group);
      const bucket = buckets.get(label) ?? [];
      bucket.push(group);
      buckets.set(label, bucket);
    });

    return [labels.today, labels.yesterday, labels.last7Days, labels.earlier]
      .map((label) => {
        const groupItems = buckets.get(label) ?? [];
        const sortedItems = [...groupItems].sort(
          (a, b) => resolveTaskTimestampValue(b.latestTask) - resolveTaskTimestampValue(a.latestTask)
        );
        return sortedItems.length ? { label, items: sortedItems } : null;
      })
      .filter(Boolean) as Array<{ label: string; items: SessionGroup[] }>;
  }, [filteredGroups, t, resolveTaskTimestampValue]);

  const imageAlt = t("input.image.alt");

  // 使用 useCallback 缓存提示词渲染函数
  const renderPrompt = useCallback((task: ImageGenerationTaskItem) => {
    if (task.prompt_encrypted) {
      return t('imageHistory.promptEncrypted');
    }
    if (task.prompt?.trim()) {
      return task.prompt.trim();
    }
    return t('imageHistory.promptEmpty');
  }, [t]);

  // 使用 useCallback 缓存 URL 构建函数
  const buildImageUrl = useCallback((nextSessionId?: string | null) => {
    const basePath = pathname || "/chat/create/image";
    const params = new URLSearchParams(searchParams?.toString());
    if (nextSessionId) {
      params.set("session", nextSessionId);
    } else {
      params.delete("session");
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }, [pathname, searchParams]);

  // 使用 useCallback 缓存会话选择处理函数
  const handleSelectSession = useCallback((session: SessionGroup) => {
    if (session.sessionId) {
      router.replace(buildImageUrl(session.sessionId));
      onClose();
      return;
    }
    setSelectedTask(session.latestTask);
  }, [router, buildImageUrl, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-4 bottom-4 left-4 w-96 z-[70] flex flex-col"
          >
            <div className="h-full w-full bg-white/92 dark:bg-[#121212]/90 backdrop-blur-2xl border border-slate-200/70 dark:border-white/5 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              <div className="p-4 border-b border-slate-200/70 dark:border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white/80 tracking-wide">
                  {t('imageHistory.title')}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-slate-600 dark:text-white/50 hover:text-slate-900 dark:hover:text-white"
                  onClick={onClose}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="px-4 py-2">
                <div className="relative group">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 dark:text-white/30 group-hover:text-slate-600 dark:group-hover:text-white/50 transition-colors" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('imageHistory.searchPlaceholder')}
                    className="w-full bg-slate-100/80 dark:bg-white/5 border border-transparent focus:border-slate-200 dark:focus:border-white/10 rounded-xl py-2 pl-9 pr-3 text-sm outline-none transition-all placeholder:text-slate-500 dark:placeholder:text-white/30 text-slate-800 dark:text-white/80"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-hidden px-2 pb-2">
                <InfiniteList
                  className="h-full"
                  isLoading={isLoadingMore}
                  isError={Boolean(error)}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  emptyDisplay={
                    <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-white/40">
                      <ImageIcon className="h-9 w-9 opacity-50" />
                      <p className="text-sm font-medium">{t('imageHistory.emptyTitle')}</p>
                      <p className="text-xs">{t('imageHistory.emptyDesc')}</p>
                    </div>
                  }
                  loadingIndicator={
                    <div className="flex items-center gap-2 text-slate-500 dark:text-white/40 text-xs">
                      <span>{t('imageHistory.loading')}</span>
                    </div>
                  }
                  errorDisplay={
                    <div className="flex flex-col items-center gap-2 text-red-500">
                      <span className="text-xs">{t('imageHistory.loadFailed')}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => reset()}
                      >
                        {t('imageHistory.retry')}
                      </Button>
                    </div>
                  }
                  noMoreDisplay={<span>{t('imageHistory.noMore')}</span>}
                >
                  {historyGroups.length > 0 ? (
                    <div className="space-y-6 py-2">
                      {historyGroups.map((group) => (
                        <div key={group.label} className="px-2">
                          <h3 className="text-[10px] font-bold text-slate-500 dark:text-white/30 uppercase tracking-wider mb-2 px-2">
                            {group.label}
                          </h3>
                          <div className="space-y-2">
                            {group.items.map((session) => (
                              <SessionCard
                                key={session.id}
                                session={session}
                                statusMeta={statusMeta}
                                imageAlt={imageAlt}
                                onSelect={handleSelectSession}
                                renderPrompt={renderPrompt}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </InfiniteList>
              </div>

              <div className="p-4 border-t border-slate-200/70 dark:border-white/5 bg-slate-50/80 dark:bg-white/[0.02]">
                <div className="w-full flex items-center justify-center gap-2 text-xs font-medium text-slate-500 dark:text-white/40">
                  <Clock className="w-3 h-3" />
                  {t('imageHistory.footer')}
                </div>
              </div>
            </div>
          </motion.div>

          <Dialog
            open={Boolean(selectedTask)}
            onOpenChange={(open) => {
              if (!open) setSelectedTask(null);
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t('imageHistory.previewTitle')}</DialogTitle>
              </DialogHeader>
              {selectedTask ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusMeta.tones[selectedTask.status] ?? "outline"}>
                      {statusMeta.labels[selectedTask.status] ?? selectedTask.status}
                    </Badge>
                    <span className="text-xs text-slate-500 dark:text-white/40">
                      {formatRelativeTime(selectedTask.updated_at)}
                    </span>
                  </div>
                  <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-white/5">
                    {selectedTask.preview?.asset_url || selectedTask.preview?.source_url ? (
                      <LazyImage
                        src={selectedTask.preview?.asset_url ?? selectedTask.preview?.source_url ?? ""}
                        alt={imageAlt}
                        className="w-full h-full"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 dark:text-white/30 gap-2">
                        <ImageIcon className="h-6 w-6" />
                        <span className="text-xs">{t('imageHistory.previewEmpty')}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 dark:text-white/40">
                      {t('imageHistory.promptLabel')}
                    </p>
                    <div className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.03] p-3 text-sm text-slate-700 dark:text-white/70">
                      {renderPrompt(selectedTask)}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-white/30">
                      {selectedTask.model}
                    </div>
                  </div>
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      )}
    </AnimatePresence>
  );
}

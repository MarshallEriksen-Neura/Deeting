'use client';

import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Image as ImageIcon, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useImageGenerationTasks } from '@/lib/swr/use-image-generation-tasks';
import { cn } from '@/lib/utils';
import type { ImageGenerationTaskItem } from '@/lib/api/image-generation';
import { formatRelativeTime } from '@/lib/api/api-keys';

interface ImageHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type StatusTone = "default" | "secondary" | "destructive" | "outline";

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

  const searchValue = search.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!searchValue) return items;
    return items.filter((item) => {
      const prompt = item.prompt ?? "";
      const model = item.model ?? "";
      const status = item.status ?? "";
      return [prompt, model, status].some((value) =>
        value.toLowerCase().includes(searchValue)
      );
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
      today: t('imageHistory.groups.today'),
      yesterday: t('imageHistory.groups.yesterday'),
      last7Days: t('imageHistory.groups.last7Days'),
      earlier: t('imageHistory.groups.earlier'),
    };

    const resolveGroupLabel = (task: ImageGenerationTaskItem) => {
      const rawDate = task.completed_at ?? task.updated_at ?? task.created_at;
      if (!rawDate) return labels.earlier;
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) return labels.earlier;
      if (date >= startOfToday) return labels.today;
      if (date >= startOfYesterday) return labels.yesterday;
      if (date >= startOfLast7Days) return labels.last7Days;
      return labels.earlier;
    };

    const buckets = new Map<string, ImageGenerationTaskItem[]>();
    filteredItems.forEach((task) => {
      const label = resolveGroupLabel(task);
      const bucket = buckets.get(label) ?? [];
      bucket.push(task);
      buckets.set(label, bucket);
    });

    return [labels.today, labels.yesterday, labels.last7Days, labels.earlier]
      .map((label) => {
        const groupItems = buckets.get(label) ?? [];
        return groupItems.length ? { label, items: groupItems } : null;
      })
      .filter(Boolean) as Array<{ label: string; items: ImageGenerationTaskItem[] }>;
  }, [filteredItems, t]);

  const imageAlt = t("input.image.alt");

  const renderPrompt = (task: ImageGenerationTaskItem) => {
    if (task.prompt_encrypted) {
      return t('imageHistory.promptEncrypted');
    }
    if (task.prompt?.trim()) {
      return task.prompt.trim();
    }
    return t('imageHistory.promptEmpty');
  };

  const buildImageUrl = (nextSessionId?: string | null) => {
    const basePath = pathname || "/chat/create/image";
    const params = new URLSearchParams(searchParams?.toString());
    if (nextSessionId) {
      params.set("session", nextSessionId);
    } else {
      params.delete("session");
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

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
                            {group.items.map((task) => {
                              const statusLabel =
                                statusMeta.labels[task.status] ?? task.status;
                              const statusTone =
                                statusMeta.tones[task.status] ?? "outline";
                              const previewUrl =
                                task.preview?.asset_url ?? task.preview?.source_url ?? null;
                              return (
                                <Button
                                  key={task.task_id}
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    if (task.session_id) {
                                      router.replace(buildImageUrl(task.session_id));
                                      onClose();
                                      return;
                                    }
                                    setSelectedTask(task);
                                  }}
                                  className={cn(
                                    "w-full rounded-2xl px-3 py-3 flex items-start gap-3 text-left",
                                    "bg-white/70 dark:bg-white/[0.03] hover:bg-white/90 dark:hover:bg-white/10",
                                    "border border-slate-200/60 dark:border-white/5"
                                  )}
                                >
                                  <div className="relative h-14 w-14 rounded-xl overflow-hidden bg-slate-100 dark:bg-white/5 shrink-0">
                                    {previewUrl ? (
                                      <Image
                                        src={previewUrl}
                                        alt={imageAlt}
                                        fill
                                        className="object-cover"
                                        sizes="56px"
                                      />
                                    ) : (
                                      <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-white/30">
                                        <ImageIcon className="h-5 w-5" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                      <Badge variant={statusTone}>{statusLabel}</Badge>
                                      <span className="text-[10px] text-slate-400 dark:text-white/30">
                                        {formatRelativeTime(task.updated_at)}
                                      </span>
                                    </div>
                                    <span className="text-xs text-slate-700 dark:text-white/70 line-clamp-2">
                                      {renderPrompt(task)}
                                    </span>
                                    <span className="text-[10px] text-slate-400 dark:text-white/30">
                                      {task.model}
                                    </span>
                                  </div>
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
                      <Image
                        src={selectedTask.preview?.asset_url ?? selectedTask.preview?.source_url ?? ""}
                        alt={imageAlt}
                        fill
                        className="object-cover"
                        sizes="(min-width: 768px) 640px, 100vw"
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

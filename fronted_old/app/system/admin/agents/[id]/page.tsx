"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Play,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

import { useI18n } from "@/lib/i18n-context";
import { useAgentTask, useRetryTask } from "@/lib/swr/use-agent-tasks";
import type { AgentTaskStatus } from "@/lib/api-types";

const STATUS_ICONS: Record<string, any> = {
  pending: Clock,
  queued: Clock,
  running: Play,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: AlertCircle,
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  queued: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  completed: "bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: "text-blue-600 dark:text-blue-400",
  warning: "text-yellow-600 dark:text-yellow-400",
  error: "text-red-600 dark:text-red-400",
};

export default function AgentTaskDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const taskId = params?.id as string;

  const { task, loading, refresh } = useAgentTask(taskId);
  const { retryTask, submitting: retrying } = useRetryTask();

  const handleRetry = useCallback(async () => {
    try {
      await retryTask(taskId);
      toast.success(t("system.agents.retry_success"));
      refresh();
    } catch (error) {
      toast.error(t("system.agents.retry_error"));
    }
  }, [retryTask, taskId, t, refresh]);

  const getStatusBadge = (status: AgentTaskStatus) => {
    const Icon = STATUS_ICONS[status] || Clock;
    const colorClass = STATUS_COLORS[status] || STATUS_COLORS.pending;

    return (
      <Badge className={colorClass} variant="secondary">
        <Icon className="w-4 h-4 mr-2" />
        {t(`system.agents.status.${status}`)}
      </Badge>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-6 max-w-7xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t("system.agents.task_not_found")}</p>
            <Link href="/system/admin/agents">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("system.agents.back_to_list")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/system/admin/agents">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t("system.agents.back_to_list")}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("system.agents.task_detail")}
            </h1>
            <p className="text-sm text-muted-foreground font-mono">{task.id}</p>
          </div>
        </div>

        {task.status === "failed" && (
          <Button onClick={handleRetry} disabled={retrying}>
            <RefreshCw className={`w-4 h-4 mr-2 ${retrying ? "animate-spin" : ""}`} />
            {t("system.agents.retry")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("system.agents.task_info")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("system.agents.status_label")}
              </p>
              <div className="mt-1">{getStatusBadge(task.status)}</div>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("system.agents.task_type")}
              </p>
              <Badge variant="outline" className="mt-1">
                {t(`system.agents.type.${task.task_type}`)}
              </Badge>
            </div>

            {task.target_url && (
              <div className="col-span-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("system.agents.url")}
                </p>
                <a
                  href={task.target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
                >
                  {task.target_url}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {task.tags && task.tags.length > 0 && (
              <div className="col-span-2">
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {t("system.agents.tags")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {task.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("system.agents.created_at")}
              </p>
              <p className="text-sm mt-1">{formatDate(task.created_at)}</p>
            </div>

            {task.started_at && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("system.agents.started_at")}
                </p>
                <p className="text-sm mt-1">{formatDate(task.started_at)}</p>
              </div>
            )}

            {task.finished_at && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("system.agents.finished_at")}
                </p>
                <p className="text-sm mt-1">{formatDate(task.finished_at)}</p>
              </div>
            )}
          </div>

          {task.progress !== undefined && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("system.agents.progress")}
                </p>
                <p className="text-sm font-medium">{task.progress}%</p>
              </div>
              <Progress value={task.progress} />
            </div>
          )}

          {task.error_message && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
                {t("system.agents.error")}
              </p>
              <p className="text-sm text-red-700 dark:text-red-300">{task.error_message}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {task.logs && task.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("system.agents.logs")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {task.logs.map((log, i) => (
                <div
                  key={i}
                  className="p-3 border rounded-lg bg-muted/30 font-mono text-xs"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`font-semibold ${LOG_LEVEL_COLORS[log.level] || ''}`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

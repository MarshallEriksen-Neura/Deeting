"use client";

import { useCallback, useState, useEffect } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Play,
  Plus,
  ExternalLink,
} from "lucide-react";

import { useI18n } from "@/lib/i18n-context";
import { useAgentTasks, useCreateCrawlTask } from "@/lib/swr/use-agent-tasks";
import type { AgentTaskStatus, AgentTaskType } from "@/lib/api-types";
import { AgentTaskForm } from "@/components/admin/agent-task-form";

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

export function AgentTaskManagementClient() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState<AgentTaskStatus | "all">("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<AgentTaskType | "all">("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ensure consistent hydration by only showing dynamic content after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  const { tasks, total, loading, refresh } = useAgentTasks({
    limit: 50,
    status: statusFilter === "all" ? undefined : statusFilter,
    task_type: taskTypeFilter === "all" ? undefined : taskTypeFilter,
  });

  const { createCrawlTask, submitting } = useCreateCrawlTask();

  const handleCreateTask = useCallback(
    async (data: { url: string; tags?: string[] }) => {
      try {
        await createCrawlTask({
          target_url: data.url,
          tags: data.tags,
          task_type: "crawl"
        });
        toast.success(t("system.agents.create_success"));
        setIsCreateDialogOpen(false);
        refresh();
      } catch (error) {
        toast.error(t("system.agents.create_error"));
      }
    },
    [createCrawlTask, t, refresh]
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status: AgentTaskStatus) => {
    const Icon = STATUS_ICONS[status] || Clock;
    const colorClass = STATUS_COLORS[status] || STATUS_COLORS.pending;

    return (
      <Badge className={colorClass} variant="secondary">
        <Icon className="w-3 h-3 mr-1" />
        {t(`system.agents.status.${status}`)}
      </Badge>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("system.agents.tasks_list")}</CardTitle>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t("system.agents.create_task")}
            </Button>
          </div>

          <div className="flex gap-4 mt-4">
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as AgentTaskStatus | "all")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("system.agents.filter_status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("system.agents.all_statuses")}</SelectItem>
                <SelectItem value="pending">{t("system.agents.status.pending")}</SelectItem>
                <SelectItem value="queued">{t("system.agents.status.queued")}</SelectItem>
                <SelectItem value="running">{t("system.agents.status.running")}</SelectItem>
                <SelectItem value="completed">{t("system.agents.status.completed")}</SelectItem>
                <SelectItem value="failed">{t("system.agents.status.failed")}</SelectItem>
                <SelectItem value="cancelled">{t("system.agents.status.cancelled")}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={taskTypeFilter}
              onValueChange={(value) => setTaskTypeFilter(value as AgentTaskType | "all")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("system.agents.filter_type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("system.agents.all_types")}</SelectItem>
                <SelectItem value="crawl">{t("system.agents.type.crawl")}</SelectItem>
                <SelectItem value="extract">{t("system.agents.type.extract")}</SelectItem>
                <SelectItem value="analyze">{t("system.agents.type.analyze")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {!mounted || loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">{t("system.agents.no_tasks")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("system.agents.task_id")}</TableHead>
                  <TableHead>{t("system.agents.task_type")}</TableHead>
                  <TableHead>{t("system.agents.status_label")}</TableHead>
                  <TableHead>{t("system.agents.url")}</TableHead>
                  <TableHead>{t("system.agents.progress")}</TableHead>
                  <TableHead>{t("system.agents.created_at")}</TableHead>
                  <TableHead className="text-right">{t("system.agents.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-xs">
                      {task.id.substring(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`system.agents.type.${task.task_type}`)}</Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(task.status)}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {task.target_url || "-"}
                    </TableCell>
                    <TableCell>
                      {task.progress !== undefined ? `${task.progress}%` : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(task.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/system/admin/agents/${task.id}`}>
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {total > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              {t("system.agents.total_tasks", { count: total })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("system.agents.create_task")}</DialogTitle>
            <DialogDescription>{t("system.agents.create_description")}</DialogDescription>
          </DialogHeader>
          <AgentTaskForm onSubmit={handleCreateTask} submitting={submitting} />
        </DialogContent>
      </Dialog>
    </>
  );
}

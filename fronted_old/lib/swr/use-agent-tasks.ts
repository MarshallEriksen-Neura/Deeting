"use client";

import { useCallback, useState } from "react";
import { useApiGet, useApiPost } from "./hooks";
import type {
  AgentTask,
  AgentTaskDetail,
  AgentTasksResponse,
  AgentTaskQueryParams,
  CreateCrawlTaskRequest,
} from "@/lib/api-types";

/**
 * Hook for fetching agent tasks list
 */
export function useAgentTasks(options: AgentTaskQueryParams = {}) {
  const { limit = 20, offset = 0, status, task_type } = options;

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (status) {
    params.set("status", status);
  }
  if (task_type) {
    params.set("task_type", task_type);
  }

  const { data, error, loading, validating, refresh } = useApiGet<AgentTasksResponse>(
    `/v1/admin/agents/tasks?${params.toString()}`,
    { strategy: "frequent" }
  );

  return {
    tasks: data?.items ?? [],
    total: data?.total ?? 0,
    error,
    loading,
    validating,
    refresh,
  };
}

/**
 * Hook for fetching a single agent task detail
 */
export function useAgentTask(taskId: string | null) {
  const { data, error, loading, validating, refresh } = useApiGet<AgentTaskDetail>(
    taskId ? `/v1/admin/agents/tasks/${taskId}` : null,
    { strategy: "frequent" }
  );

  return {
    task: data,
    error,
    loading,
    validating,
    refresh,
  };
}

/**
 * Hook for creating a crawl task
 */
export function useCreateCrawlTask() {
  const mutation = useApiPost<AgentTask, CreateCrawlTaskRequest>(
    "/v1/admin/agents/crawl"
  );

  const createCrawlTask = useCallback(
    async (request: CreateCrawlTaskRequest): Promise<AgentTask> => {
      return mutation.trigger(request);
    },
    [mutation]
  );

  return {
    createCrawlTask,
    submitting: mutation.submitting,
    error: mutation.error,
  };
}

/**
 * Hook for retrying a failed task
 */
export function useRetryTask() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<any>(null);

  const retryTask = useCallback(
    async (taskId: string): Promise<AgentTask> => {
      setSubmitting(true);
      setError(null);
      try {
        const response = await fetch(`/v1/admin/agents/tasks/${taskId}/retry`, {
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("Failed to retry task");
        }
        const data = await response.json();
        setSubmitting(false);
        return data;
      } catch (err) {
        setError(err);
        setSubmitting(false);
        throw err;
      }
    },
    []
  );

  return {
    retryTask,
    submitting,
    error,
  };
}

export default useAgentTasks;

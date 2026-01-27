import { fetcher } from "@/lib/api/fetcher";

export type VideoGenerationTaskCreateRequest = {
  model: string;
  prompt: string;
  negative_prompt?: string;
  image_url?: string;
  width?: number;
  height?: number;
  aspect_ratio?: string;
  duration?: number;
  fps?: number;
  motion_bucket_id?: number;
  num_outputs?: number;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  quality?: string;
  style?: string;
  extra_params?: Record<string, any>;
  provider_model_id?: string;
  session_id?: string;
  request_id?: string;
  encrypt_prompt?: boolean;
};

export type VideoGenerationTaskCreateResponse = {
  task_id: string;
  status: string;
  created_at: string;
  deduped: boolean;
};

export type VideoGenerationOutputItem = {
  output_index: number;
  asset_url?: string;
  cover_url?: string;
  source_url?: string;
  seed?: number;
  content_type?: string;
  size_bytes?: number;
  width?: number;
  height?: number;
  duration?: number;
};

export type VideoGenerationTaskListItem = {
  task_id: string;
  status: string;
  model: string;
  session_id?: string;
  prompt?: string;
  prompt_encrypted: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  error_code?: string;
  error_message?: string;
  preview?: VideoGenerationOutputItem;
};

export type VideoGenerationTaskDetail = {
  task_id: string;
  status: string;
  model: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  error_code?: string;
  error_message?: string;
  outputs: VideoGenerationOutputItem[];
};

export const createVideoGenerationTask = (
  payload: VideoGenerationTaskCreateRequest
) => {
  return fetcher.post<VideoGenerationTaskCreateResponse>(
    "/internal/videos/generations",
    payload
  );
};

export const listVideoGenerationTasks = (params?: {
  cursor?: string;
  size?: number;
  status?: string;
  include_outputs?: boolean;
  session_id?: string;
}) => {
  return fetcher.get<{
    items: VideoGenerationTaskListItem[];
    total: number;
    page: number;
    size: number;
    pages: number;
    next_page: string | null;
    previous_page: string | null;
  }>("/internal/videos/generations", { params });
};

export const getVideoGenerationTask = (taskId: string) => {
  return fetcher.get<VideoGenerationTaskDetail>(
    `/internal/videos/generations/${taskId}`
  );
};

export const cancelVideoGenerationTask = (requestId: string) => {
  return fetcher.post<{ request_id: string; status: string }>(
    `/internal/videos/generations/${requestId}/cancel`
  );
};

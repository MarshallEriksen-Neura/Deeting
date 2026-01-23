# 内部文生图（Image Generation）

仅内部通道可用。基于任务化异步模式：HTTP 创建任务，HTTP 查询状态，SSE 轮询事件流。

## 鉴权
- 需要用户登录（Bearer Token）

## POST /internal/images/generations
创建文生图任务（异步）。

请求体字段（节选）：
- `model` string，模型标识（必填）
- `prompt` string，提示词（必填）
- `provider_model_id` UUID，内部模型实例（必填）
- `negative_prompt` string，可选
- `width`/`height`/`aspect_ratio`，可选
- `num_outputs` number，默认 1
- `steps`/`cfg_scale`/`seed`/`sampler_name`/`quality`/`style`，可选
- `extra_params` object，可选
- `session_id` string，可选（会话关联）
- `request_id` string，可选（幂等；用于取消）
- `encrypt_prompt` boolean，是否保存加密提示词（默认 false）

响应示例：
```json
{
  "task_id": "3f1e7c3d-8b6c-4d5c-8c7f-4c3c2b9d9a12",
  "status": "queued",
  "created_at": "2026-01-19T08:00:00+00:00",
  "deduped": false
}
```

## GET /internal/images/generations
获取文生图任务列表（分页）。

查询参数：
- `cursor` string，可选
- `size` number，可选，默认 20
- `status` string，可选（queued/running/succeeded/failed/canceled）
- `include_outputs` boolean，可选，默认 true（是否包含预览输出）
- `session_id` string，可选（会话 ID）

响应示例：
```json
{
  "items": [
    {
      "task_id": "3f1e7c3d-8b6c-4d5c-8c7f-4c3c2b9d9a12",
      "status": "succeeded",
      "model": "gpt-image-1",
      "session_id": "2d126c4c-2d1c-4fd4-99a9-1b53c1c0a8d0",
      "prompt": "a city at night",
      "prompt_encrypted": false,
      "created_at": "2026-01-19T08:00:00+00:00",
      "updated_at": "2026-01-19T08:00:12+00:00",
      "completed_at": "2026-01-19T08:00:12+00:00",
      "preview": {
        "output_index": 0,
        "asset_url": "https://api.example.com/api/v1/media/assets/...",
        "source_url": null,
        "seed": 123,
        "content_type": "image/png",
        "size_bytes": 123456,
        "width": 1024,
        "height": 1024
      }
    }
  ],
  "next_page": null,
  "previous_page": null
}
```

说明：
- 当任务使用 `encrypt_prompt=true` 保存时，列表接口会返回 `prompt=null` 且 `prompt_encrypted=true`。

## GET /internal/images/generations/{task_id}
查询任务状态（可返回结果）。

查询参数：
- `include_outputs` boolean，默认 true

响应示例：
```json
{
  "task_id": "3f1e7c3d-8b6c-4d5c-8c7f-4c3c2b9d9a12",
  "status": "succeeded",
  "model": "gpt-image-1",
  "created_at": "2026-01-19T08:00:00+00:00",
  "updated_at": "2026-01-19T08:00:12+00:00",
  "completed_at": "2026-01-19T08:00:12+00:00",
  "error_code": null,
  "error_message": null,
  "outputs": [
    {
      "output_index": 0,
      "asset_url": "https://api.example.com/api/v1/media/assets/...",
      "source_url": null,
      "seed": 123,
      "content_type": "image/png",
      "size_bytes": 123456,
      "width": 1024,
      "height": 1024
    }
  ]
}
```

## POST /internal/images/generations/{request_id}/cancel
取消任务（最佳努力）。基于 `request_id` 标记取消；任务侧会在运行期间消费取消标记并停止。

响应示例：
```json
{
  "request_id": "req-20260123-abcdef",
  "status": "canceled"
}
```

## GET /internal/images/generations/{task_id}/events
SSE 事件流（轮询式）。用于前端持续追踪任务状态。

查询参数：
- `poll_interval` number，轮询间隔（秒），默认 1.0
- `timeout_seconds` number，最大等待秒数，默认 300

事件示例：
```
data: {"type":"status","task_id":"...","status":"running","updated_at":"..."}

data: {"type":"status","task_id":"...","status":"succeeded","outputs":[...]}

data: [DONE]
```

---

## 存储策略
- 生成结果写入 `media_asset`（去重索引 + 对象存储）。
- 默认 `expire_at`=90 天；对象存储建议配置 Lifecycle 清理。

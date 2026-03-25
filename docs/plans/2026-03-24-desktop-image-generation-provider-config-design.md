# Desktop Image Generation Provider Config Design

Date: 2026-03-24

## Summary

桌面端 `image_generation` 需要从“默认打 OpenAI 兼容路径”升级为“用户可在模型编辑页配置 submit/poll/result extraction 的协议化图像生成模型”。首版只覆盖 `image_generation`，不混入 `video_generation` 与 `text_to_speech`，但底层 contract 需要同时覆盖文生图与图生图。

本轮采用 **表单优先 + 高级 JSON 兜底** 的方案：常见直返图片与异步 task 轮询都提供结构化表单，复杂 provider 仍可通过高级 JSON 微调 `config_override`。

## Why now

当前桌面端图像生成存在三个核心问题：

- 运行时默认把图像模型视作 OpenAI 兼容 `v1/images/generations`，对自定义 provider 不够真实。
- 图像任务虽然收集了 `aspect_ratio`、`steps`、`cfg_scale`、`num_outputs` 等字段，但运行时只把 `model` 与 `prompt` 传给上游。
- 运行层已经具备 `async_config` 轮询能力，却没有模型编辑页入口让用户配置 task-id 提取、poll URL、状态字段和值映射。

这导致 Minimax、ModelScope、Gitee 这类常见图像 provider 只能靠硬编码或撞接口试错，缺少 chat 那种“模型配置即真相”的专业体验。

## Goals

- 让桌面端 `image_generation` 模型可以在模型编辑页配置真实 submit 接口与异步轮询行为。
- 将前端图像任务字段统一进入一套 canonical image request，再由模板映射到上游字段。
- 让 `image_url` / 参考图输入成为 canonical image request 的一等字段，避免后续做图生图时重新切 runtime contract。
- 保留当前 Rust 运行层的 `async_config` 能力，但把它提升为产品可配置项。
- 为 Minimax、ModelScope、Gitee 这类 provider 提供可落地的配置形态，而不是继续写 provider-specific 逻辑分支。

## Non-Goals

- 本轮不处理 `video_generation`。
- 本轮不做 `text_to_speech` 配置面，只在设计上避免阻塞未来扩展。
- 本轮不引入云端 provider 管理改造，仅处理桌面本地 provider 编辑与调用。
- 本轮不做完全自由的 protocol editor 作为主交互；高级 JSON 仅作逃生口。

## Current seams

### 1. Model editor can edit path, but not image protocol

模型编辑页现在只暴露：

- `capabilities`
- `upstream_path`
- chat 专用 `requestMode`

图像模型没有对应的“直返 / 异步 task / 自定义提取”配置面。

### 2. Runtime already supports async polling

`deeting/src-tauri/src/modules/ai_upstream/image.rs` 已支持：

- `task_id_extraction`
- `poll.url_template`
- `poll.headers`
- `status_check.location`
- `success_values / fail_values / pending_values`
- `result_extraction`

因此本轮重点不是重写轮询器，而是把这套能力和模型配置 contract 打通。

### 3. Image request fields stop too early

图像任务创建请求已经包含：

- `negative_prompt`
- `aspect_ratio`
- `num_outputs`
- `steps`
- `cfg_scale`
- `seed`
- `quality`
- `style`
- `response_format`
- `image_url`
- `extra_params`

但调用上游时只传入了 `provider_model_id`、`model`、`prompt`。这让很多 provider-specific 字段无法到达模板层，也意味着图生图虽然在类型上留了口子，却还不算真的支持。

## Target architecture

### 1. Canonical image request

桌面端 image task 在调用 provider runtime 前，统一整理为 canonical image request：

- `model`
- `prompt`
- `negative_prompt`
- `width`
- `height`
- `aspect_ratio`
- `num_outputs`
- `steps`
- `cfg_scale`
- `seed`
- `sampler_name`
- `quality`
- `style`
- `response_format`
- `image_url`
- `extra_params`

模板渲染层只消费这套 canonical input，不直接读取 UI 组件状态。

说明：

- 当 `image_url` 为空时，这是一条文生图请求。
- 当 `image_url` 有值时，这是一条图生图 / 参考图生成请求。
- provider-specific 模板决定它映射成 `image_url`、`image`、`init_image`、`control_image` 或其他上游字段名。

### 2. Image request mode

为 `image_generation` 引入独立于 chat 的请求模式：

- `direct`
- `async_poll`
- `custom`

规则：

- `direct` 表示提交请求后直接从响应中提取图片 url/b64。
- `async_poll` 表示提交请求先返回 task id，再根据 poll 配置轮询。
- `custom` 仍建立在上面两类能力上，但允许高级 JSON 覆盖 submit/poll/result 细节。

### 3. Config shape

图像协议配置存放于 `config_override.image_generation`，按运行时已有能力组织：

- `request_template`
- `template_engine`
- `default_headers`
- `default_params`
- `async_config`
- `response_transform`

推荐再补一个更清晰的 UI 级语义字段：

- `submission_mode`: `direct | async_poll`

运行时可以在读配置时将其转译为现有 `async_config` 行为，而不要求数据库层新增字段。

### 4. Form-first editor

模型编辑页在 capability 包含 `image_generation` 时，新增一个 Image Provider Configuration 区块：

- 基础：
  - Submit mode
  - Submit path
  - Template engine
  - Input support：Text-only / Text + Reference Image
- Submit request：
  - Request template
  - Default headers
  - Optional provider field mapping presets
- Async poll（仅 async 模式显示）：
  - Task ID path
  - Poll URL template
  - Poll method
  - Poll headers
  - Poll interval
  - Poll timeout
  - Status path
  - Pending values
  - Success values
  - Fail values
  - Result path
  - Result format
- Advanced：
  - 原始 `config_override.image_generation` JSON 折叠编辑器

图片生成页首版输入面保持克制：

- 至少支持 `reference image URL` 或已有本地 asset URL 作为 `image_url`
- 不在本轮强推复杂蒙版、区域编辑、多图混合
- 但 contract 上不阻止未来把上传图片、mask、control image 继续归入 `extra_params`

### 5. Test surface

模型编辑页增加 image test action，测试时应展示：

- resolved submit URL
- rendered request body
- submit response
- 如果为 async：
  - poll URL
  - latest poll status
  - final extracted result

这一步是“专业感”的关键，避免用户只能保存后再去图片页撞错。

如果模型声明支持参考图输入，测试面应允许附带 `image_url`，这样图生图链路可以在模型编辑页直接完成验证。

## Provider examples

### Minimax

- `submission_mode = direct`
- submit path: `v1/image_generation`
- request template maps:
  - `aspect_ratio -> aspect_ratio`
  - `num_outputs -> n`
  - `extra_params.prompt_optimizer -> prompt_optimizer`
  - `image_url -> image` 或 provider 要求的参考图字段（若该模型支持）

### ModelScope

- `submission_mode = async_poll`
- submit path: `v1/images/generations`
- submit headers:
  - `X-ModelScope-Async-Mode: true`
- poll URL template:
  - `{{base_url}}tasks/{{task_id}}`
- poll headers:
  - `X-ModelScope-Task-Type: image_generation`
- status path:
  - `task_status`
- success values:
  - `SUCCEED`
- fail values:
  - `FAILED`
- result path:
  - `output_images`
- result format:
  - `url_list`

如果后续某些 ModelScope 模型支持图生图，仍然可以沿用同一 async contract，只需在 request template 中把 `image_url` 映射到对应上游字段。

### Gitee

- `submission_mode = async_poll`
- submit path: `v1/async/images/generations`
- task id path:
  - `task_id`
- poll URL template:
  - `{{base_url}}task/{{task_id}}`
- status path:
  - `status`
- success values:
  - `success`
- fail values:
  - `failed`, `cancelled`
- result path:
  - `output.file_url`

若 provider 的图生图接口与文生图分 path，也可以通过模型级 submit path 单独配置，而不必修改 runtime 分支。

## Acceptance criteria

- 模型编辑页可为 image models 配置 direct 或 async poll 模式。
- image task 的完整 canonical fields 能到达 request renderer。
- canonical request 对文生图与图生图都成立，`image_url` 能进入模板映射。
- Minimax/ModelScope/Gitee 这三类典型 provider 都能通过配置表达，无需新增 provider-specific Rust 分支。
- 用户能在模型编辑页完成 image request 测试并看到 submit/poll/debug 结果。

## Risks

- 如果把 UI 表单字段直接绑定到 provider-specific 名称，会很快退化回硬编码适配。
- 如果 `config_override` 仍只以大 JSON blob 暴露，用户体验会很差。
- 如果 image test 只测 submit，不展示 poll 细节，async provider 仍然难用。

## Design rule

- image provider 的真相源是模型级协议配置，不是 Rust 里按 provider 名称硬编码的接口分支。

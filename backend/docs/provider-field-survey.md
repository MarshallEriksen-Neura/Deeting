# 主流厂商多模态请求字段对照（2026-01-05）

> 目的：梳理 Chat / Image / Audio / Video 四类能力在主流厂商 API 的请求字段，便于后续网关统一字段与映射规则。

## 1. Chat / 多模态聊天

| 厂商 | 必填字段 | 常用可选字段 | 说明 |
| --- | --- | --- | --- |
| OpenAI Chat Completions | `model`, `messages` | `temperature`, `top_p`, `max_tokens`, `stream`, `tools`/`tool_choice`, `response_format`, `stop`, `frequency_penalty`, `presence_penalty`, `logit_bias`, `seed`, `stream_options`, `top_logprobs`, `modalities`, `audio` (当输出音频) | 支持文本+图片输入；`stream` 为 SSE；工具调用统一放在 `tools`。citeturn0search1 |
| Anthropic Messages (Claude 3.x/4.x) | `model`, `messages`, `max_tokens` | `system`, `stop_sequences`, `temperature`, `top_p`, `top_k`, `stream`, `metadata`, `service_tier`, `container`, `mcp_servers`, `tools` | `system` 为顶层字段；`max_tokens` 必填；支持多模态输入（图像）。citeturn0search0turn0search6 |
| Google Gemini `models/{id}:generateContent` | `model`, `contents[]` | `systemInstruction`, `safetySettings[]`, `generationConfig`（包含 `temperature`, `top_p`, `max_output_tokens`, `stop_sequences` 等），`tools[]`，`toolConfig`, `cachedContent` | `contents` 里可混合文本、图片、音频、视频；`safetySettings` 为官方内容安全控制。citeturn0search8turn0search2 |

## 2. Image 生成

| 厂商 | 关键字段 | 说明 |
| --- | --- | --- |
| OpenAI Image Generation / `image_generation` tool | `prompt`/对话中的 `image_generation` 工具调用，`model`（如 `gpt-image-1`），`size`，`quality`，`format`，`background`，`output_compression` | 支持 `auto` 选择尺寸/质量；返回 base64。citeturn1search0turn1search2 |
| Google Gemini 图像生成 | `model`（如 `gemini-2.5-flash-image`），`contents`（文本+可选参考图），`config.response_modalities`，可选 `aspect_ratio` | `response_modalities=['Image']` 可仅返图；默认带水印 SynthID。citeturn1search7 |

## 3. Audio（TTS / STT / 多模态音频）

| 厂商 | 能力 | 必填字段 | 可选字段 | 说明 |
| --- | --- | --- | --- | --- |
| OpenAI `POST /v1/audio/speech`（TTS） | 文本转语音 | `model`（`tts-1` / `tts-1-hd` / `gpt-4o-mini-tts`），`input`，`voice` | `response_format`（mp3/opus/aac/flac/wav/pcm），`speed` | 最大 4096 字符。citeturn2search6 |
| OpenAI `POST /v1/audio/transcriptions`（STT） | 语音转文本 | `file`, `model` | `prompt`, `temperature`, `language`, `response_format` | 支持多音频格式；Whisper/`gpt-4o-transcribe` 等模型。citeturn2search3 |
| OpenAI Chat 多模态音频 | 文本↔音频 | `modalities` 包含 `"audio"`，`audio` 对象含 `voice`, `format` | 与 Chat 其余字段共享 | 通过 Chat Completions 直接返音频。citeturn0search1 |

## 4. Video

| 厂商 | 能力 | 主要字段 | 说明 |
| --- | --- | --- | --- |
| Google Gemini / Veo 3.x 视频生成 | `prompt`，可选 `negativePrompt`，`aspectRatio`（16:9/9:16），`resolution`（720p/1080p），`durationSeconds`（4/6/8），`personGeneration`，`referenceImages[]`，`video`（扩展） | 通过 Gemini API 调用 Veo 3.1/3 Fast；支持 text→video、image→video、video extend；默认 24fps、最长 8s；可生成带原生音频。citeturn2search7turn2news12 |
| Google Gemini 视频理解 | `contents` 中上传视频（Base64 或 File API），可设 `mediaResolution`、帧率 | 1 FPS 采样默认，可自定义；最长 1h（低分辨率可 3h）。citeturn2search5 |

## 5. 建议的网关统一字段草案

- 通用元信息：`provider`, `capability`（chat/image/audio/video），`model`, `request_id`, `stream`.
- 输入：`messages`（统一 role/content 结构，可包含 `media` 列表，类型 text/image/audio/video），`system`, `tools`, `tool_choice`.
- 生成控制：`max_tokens`, `temperature`, `top_p`, `top_k`, `stop`/`stop_sequences`, `presence_penalty`, `frequency_penalty`, `seed`.
- 安全/合规：`safety_settings`（结构化，兼容 Gemini），`user_identifier`/`safety_identifier`.
- 图像专属：`image.size`, `image.quality`, `image.format`, `image.background`, `image.output_compression`.
- 音频专属：`audio.voice`, `audio.format`, `audio.speed`.
- 视频专属：`video.aspect_ratio`, `video.resolution`, `video.duration_seconds`, `video.reference_images`, `video.negative_prompt`, `video.person_generation`.
- 计费挂钩：`pricing_mode`, `input_tokens`, `output_tokens`, `media_tokens`（图/音/视频帧），`currency`.

> 代码落地点：  
> - 统一字段集合与 Schema：`backend/app/schemas/gateway_fields.py`（含版本号、字段白名单）。  
> - `provider_preset` Schema 校验：`backend/app/schemas/provider_preset.py` 在 `request_template.gateway_fields` 上做字段白名单校验，并要求 `pricing_config` 按 capability 补齐图/音/视频定价。  
> 后续步骤：  
> 1) 在 `provider_preset_item.pricing_config` 中为新增的图/音/视频维度补充单价与限流字段；  
> 2) 路由层按 `capability`+`model` 做字段校验与映射；  
> 3) 测试覆盖多模态（图/音/视频）请求的字段转换与计费路径。

# Chat Voice Capability Foundation Design

Date: 2026-03-24

## Summary

语音在当前 Deeting 架构中不应再作为独立页面或独立业务中心存在，而应作为 `chat` 的能力层融入现有 `conversation_message -> meta_info.blocks -> asset storage` 体系。

本轮底层设计明确分成两条能力：

- `speech_to_text`：将音频输入转成文本，最终回到 chat message
- `text_to_speech`：将文本输出转成音频资产，最终回到 `audio.result` block

一期实现优先 `TTS`，但同时把 `STT` 的 contract 和模块边界定好，避免后续再次返工。

## Why now

当前项目已经完成了图片链路收口：

- 主入口收敛到 chat
- task agent 负责能力执行
- UI 结果回到 `image.result` block
- 独立图片页、独立分享/画廊方案都已下线

这为语音打下了正确的架构前提。  
如果此时把语音再做成单独页面、单独状态和单独历史，后续会重新回到“一套业务多处方案”的维护问题。

## Goals

- 让语音能力完全融入当前 chat-only 架构。
- 为 `TTS` 和 `STT` 建立可扩展的底层模块，不再把逻辑散落在页面或单一业务文件中。
- 让 `TTS` 的结果通过 `audio.result` block 进入 chat 对话历史。
- 让 `STT` 的结果最终表现为一条普通文本消息，而不是独立语音工作流。
- 为未来“电台 / 播报 / 朗读 / 语音助手”玩法准备底层能力，但不把这些玩法硬编码进基础层。

## Non-Goals

- 本轮不做实时 voice chat / talk mode。
- 本轮不做独立语音页面。
- 本轮不实现电台节目业务逻辑。
- 本轮不先统一所有厂商的 STT/TTS 供应商差异，只定义统一 capability contract。

## Core stance

### 1. Voice is a modality, not a business center

语音在当前项目中的角色不是新的“主业务对象”，而是：

- `STT` 作为输入模态
- `TTS` 作为输出模态

这意味着它们应该附着在 chat 主链路上，而不是和 chat 平行。

### 2. TTS is easier to land than STT

在当前阶段：

- `TTS` 更适合作为一期优先实现对象
- 因为它直接作用于 assistant 已生成的文本回复
- 更容易复用当前 `task agent -> render block -> asset` 架构

`STT` 虽然也适合并入 chat，但更像输入层能力，通常还会牵涉录音、文件/音频上传、转写时机等产品问题，因此一期只把底层 contract 和模块边界定好。

## Current seams

### 1. Provider capability layer already knows TTS/STT

provider capability 与默认 request template 已存在：

- `text_to_speech`
- `speech_to_text`

这说明 provider runtime 不是从零开始，只是当前还没有接到 task agent 和 chat 渲染主链。

### 2. Chat block architecture already exists

当前 chat 已有：

- `ui` block
- `image.result` view
- asset storage / local chat asset read path

因此 `audio.result` 本质上应该是 image.result 的语音对等物，而不是一条平行的新消息体系。

### 3. Custom task agent execution model is still too enum-centric

当前 `CustomTaskAgentInvocationKind` 只有：

- `chat`
- `image_generation`

如果继续沿这个 enum 增长：

- `speech_to_text`
- `text_to_speech`
- `video_generation`

后续会越来越难维护。  
应该趁现在转成更稳定的双层模型。

## Target architecture

### 1. Execution model

将 task agent 执行模型从“业务枚举”提升为“执行类型 + 能力类型”：

- `execution_kind`
  - `chat`
  - `single_capability`

- `capability`
  - `image_generation`
  - `text_to_speech`
  - `speech_to_text`

规则：

- `chat`：多轮推理/工具调用型 agent
- `single_capability`：一次性调用某个能力型 provider/runtime，并返回标准结果块

这样图片、语音、后续视频都能共用同一模式。

### 2. Voice modules

新增或重构为以下模块：

- `src-tauri/src/modules/audio/`
  - `types.rs`
  - `storage.rs`
  - `result_blocks.rs`
  - `commands.rs`

- `src-tauri/src/modules/voice_capabilities/`
  - `tts.rs`
  - `stt.rs`
  - `types.rs`
  - `request_runtime.rs`

职责分离：

- `audio/` 负责音频资产与 chat 渲染结果
- `voice_capabilities/` 负责调用供应商能力
- `custom_task_agents/` 只负责选择谁执行、默认参数是什么

### 3. Data truth

音频二进制不写进 `conversation_message`。  
唯一真相源仍然是：

- `conversation_message`
- `meta_info.blocks`

其中：

- `TTS` 的结果以 `audio.result` block 持久化
- `STT` 的最终文本表现为普通 `user` 或 `assistant` 文本消息
- 音频文件本体只进入 asset storage

### 4. New block type

新增 `audio.result` 视图类型：

- `viewType = "audio.result"`
- payload 至少包含：
  - `asset_url` / `source_url`
  - `content_type`
  - `duration_ms`（可选）
  - `voice`
  - `model`
  - `transcript`（可选）
  - `prompt_text`（可选）

前端渲染为可播放卡片，而不是普通工具结果文本。

### 5. TTS flow

一期 `TTS` 推荐路径：

1. 用户显式调用 `@播音员 朗读这段话`
   或系统对某条 assistant 回复触发朗读
2. task agent / capability runtime 调 `text_to_speech`
3. 返回音频资产
4. 将结果转成 `audio.result` block
5. block 写入 chat 会话

### 6. STT flow

一期 `STT` 不先做完整产品交互，但底层 contract 定成：

1. 输入：音频资产 / 文件 / URL
2. capability runtime 调 `speech_to_text`
3. 返回文本
4. 文本进入 chat 消息
5. 可选附带原始音频引用作为附件或辅助 metadata

### 7. Future radio fit

“今日电台”以后不应直接基于实时 TTS 页面实现，而是建立在本底层之上：

- 先有脚本
- 再生成音频资产
- 再作为 episode 存储

电台属于上层玩法，不进入本轮基础设计。

## Provider stance

不要求一开始为所有厂商做完全统一 adapter。

一期建议：

- `TTS`
  - 先支持少数 provider + OpenAI-compatible 路径
- `STT`
  - 先支持少数明确 provider 或平台接入

核心不是“全厂商兼容”，而是让能力 contract 稳定。

## Acceptance criteria

- `TTS` 与 `STT` 有明确模块边界，不再依附单独页面。
- task agent execution model 支持 `single_capability`。
- chat 渲染层支持 `audio.result` block。
- `TTS` 结果可以成为 chat 对话历史的一部分。
- `STT` contract 已定义，后续可增量实现而无需推翻架构。

## Risks

- 如果继续把能力塞进 `invocation_kind` enum，后续维护成本会持续上涨。
- 如果 `audio.result` 只是普通文本消息的附件而不是标准 block，后续玩法扩展会很受限。
- 如果先做“实时语音对话”而不是基础 `TTS/STT capability`，工程复杂度会明显高于当前阶段需要。

## Design rule

- 语音在当前项目中是 chat 的输入/输出能力，不是新的独立产品面。

# Chat Mention Triggered Image Task Agent Design

Date: 2026-03-24

## Summary

桌面端不再把图片生成一期产品心智放在独立图片页，而是让用户在 chat 页面通过显式 `@agent` 唤起图片型 task agent，例如：`@达芬奇 画一只猫`。  

首版只做 **显式 mention 唤起**，不做自然语言自动识别，不做多轮“锁定 agent 会话”。独立图片页先保留为历史记录和调试入口，不作为主入口继续扩功能。

## Why now

当前桌面端已有两个已经存在但割裂的事实：

- `custom_task_agent` 已经支持 `invocation_kind = image_generation`，并且能直接调用本地图片生成链路；
- chat runtime 的 worker lane 已经能为图片型 task agent 产出 `image.result` UI block，但主要还是服务于模糊匹配与 delegated worker path，而不是用户在 chat 中显式指定某个图片 agent。

这意味着真正缺失的不是图片运行时，而是：

- chat 输入里的显式 agent 选择 contract；
- control plane 对显式 choice 的优先级；
- chat lane 中对图片型 agent 执行结果的闭环表达。

## Goals

- 支持用户在 chat 页面通过 `@agent` 显式唤起图片型 task agent。
- 让图片生成结果直接回到当前 chat 对话流里显示，不再强依赖独立图片页。
- 保持一期产品边界清晰：只支持显式 mention，不做自然语言 agent 识别。
- 复用现有 `custom_task_agent` 与 `image.result` block 能力，避免重写图片渲染协议。

## Non-Goals

- 本轮不做自然语言“叫达芬奇给我画一只猫”的自动 agent 识别。
- 本轮不做 mention 后多轮会话锁定 agent。
- 本轮不删除独立图片页。
- 本轮不处理 `video_generation`。

## Current seams

### 1. Image task agents already exist

`custom_task_agents/runtime.rs` 中，当 profile 的 `invocation_kind == ImageGeneration` 时，预览执行会直接调用 `run_local_image_generation_task_inline(...)`。

这说明 “达芬奇” 这样的图片 agent 本身并不需要新 runtime 类型；产品层只需要把 chat 显式选择接上去。

### 2. Worker handler already knows how to render image results

`desktop_runtime/runtime/execution_plane/worker_handler.rs` 已会为图片型 task agent 生成：

- `view_type = image.result`
- `payload.preview`
- `payload.outputs`
- `payload.prompt`
- `payload.model`

`components/views/registry.ts` 也已经注册了 `image.result` 对应视图。因此 chat 渲染层并不是从零开始支持图片消息。

### 3. The missing piece is explicit routing truth

当前 `control_plane.rs` 更像是：

- 从 query 文本里做模糊匹配；
- 根据图片意图和 `preferred_for_image_generation` 提升某些 agent 权重；
- 再让 worker delegation 接管。

这不等于“用户显式说了要找达芬奇”。首版需要一套比模糊匹配更高优先级的显式 mention contract。

## Recommended approach

### Option A: Explicit `@agent` mention in chat input

例子：

- `@达芬奇 画一只猫`
- `@海报师 给我做一张 16:9 发布海报`

行为：

1. chat 输入层解析首个显式 mention
2. 若命中本地 custom task agent：
   - 记录 `explicit_task_agent_ref`
   - 从用户真正 prompt 中去掉 mention 前缀
3. control plane 优先使用显式 task agent，而不是走模糊 candidate 选择
4. 若该 agent 为 `image_generation`：
   - 直接走现有图片执行链
   - 返回 `image.result` block 到当前 chat

优点：

- 工程复杂度最低；
- 用户心智最清楚；
- 最适合一期产品收敛。

### Option B: Mention selects temporary session agent

例子：

- 先发送 `@达芬奇`
- 后续 1-2 条消息默认走该 agent

优点：

- 更像“跟某个 agent 对话”

缺点：

- 会引入 session-level selected agent 状态；
- 切换、清除、历史回放都更复杂。

### Option C: Natural language auto-routing

例子：

- `叫达芬奇给我画一只猫`

优点：

- 最自然

缺点：

- 需要做 agent 名称解析与歧义处理；
- 很容易和普通聊天文本冲突；
- 一期不值得。

## Chosen direction

选 **Option A**：

- 只支持显式 `@agent`
- mention 只在当前发送消息中生效
- 如果没写 `@`，维持现有 control plane 行为

## Target architecture

### 1. Chat input mention parsing

在前端 chat 发送前解析首个显式 `@agent`：

- 输入原文：`@达芬奇 画一只猫`
- 解析结果：
  - `explicitTaskAgentName = "达芬奇"`
  - `effectivePrompt = "画一只猫"`

一期只要求：

- mention 位于消息开头附近
- 只处理首个 mention

不要求：

- 行内多个 mention
- 复杂 markdown/代码块中的 mention

### 2. Explicit task-agent ref in send payload

发送到桌面本地 chat runtime 时，携带一个显式字段，例如：

- `explicit_task_agent_id`
  或
- `explicit_task_agent_name`

推荐优先用 id，但前端首次解析时可以先基于名称在本地 catalog 中解析成 id。

### 3. Control plane precedence

control plane 新增显式 agent 分支：

1. 如果 payload 有 `explicit_task_agent_id`
   - 直接加载对应 profile
   - 跳过模糊 `select_worker_custom_task_agent(...)`
2. 如果 profile 为 `image_generation`
   - route 到 worker lane
   - reason 明确标记为 `explicit_task_agent`

这样可以把“用户点名达芬奇”与“系统猜你想画图”严格区分开。

### 4. Execution plane integration

worker execution handler 不需要发明新的图片协议：

- 继续复用 `preview_custom_task_agent(...)`
- 继续复用 `run_local_image_generation_task_inline(...)`
- 继续输出 `image.result` render block

需要调整的是：

- 不把结果仅仅包装成 delegated worker 的隐式内部反馈
- 而是让当前 chat 对话把图片 block 当成正常 assistant output 使用

### 5. Chat message rendering

chat 渲染层保持 block-first：

- assistant 文本说明
- `ui` block with `viewType = image.result`

如果图片 agent 没有文字输出，也至少要有：

- 一条简短 assistant text，例如 `达芬奇已完成绘图`
- 紧跟 `image.result` block

这样历史回放、滚动定位和空内容保护都更稳。

### 6. Separate image page role after convergence

独立图片页一期不删除，角色调整为：

- 历史记录查看
- 失败重试/调试
- 参数调优工作台

主生产入口转到 chat mention 路径。

## UX rules

- 图片型 agent 在 chat 输入框 mention 自动补全中应有明显标识，例如 `image` badge。
- 若用户 `@` 到了非图片 agent，但输入明显是绘图命令，一期不自动改写，只按该 agent 的真实 `invocation_kind` 执行或报错。
- 若 mention 目标不存在，应在发送前本地报错，不要把原文当普通聊天 silently 发出去。
- 若 mention 后没有剩余 prompt，应阻止发送并提示用户补充绘图描述。

## Acceptance criteria

- 用户可在 chat 中发送 `@达芬奇 画一只猫` 并命中指定图片 task agent。
- 当前对话里能直接显示 `image.result` 卡片。
- 不写 `@` 时，现有 worker/control-plane 行为保持兼容。
- 独立图片页仍可继续查看或调试历史任务，不影响一期上线。

## Risks

- 如果 mention 只按名称做弱匹配，重名 agent 会带来歧义；最好在前端选择阶段就解析成 id。
- 如果执行结果仍只走 delegated debug payload 而不作为正常 assistant block 渲染，chat 体验会很怪。
- 如果一开始就引入“mention 后多轮锁定 agent”，会把状态复杂度和回放复杂度明显拉高。

## Design rule

- 一期把 `@agent` 当作显式路由指令，不当作自然语言的一部分，也不把它做成隐式智能猜测。

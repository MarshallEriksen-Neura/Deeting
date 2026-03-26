# Desktop Chat Retention Design

**Date:** 2026-03-26

**Scope:** `desktop local`

## Goal

在桌面端设置页提供“聊天记录保留多少天”的本地配置，让应用按会话最后活跃时间自动清理过期本地聊天，避免 SQLite 数据持续膨胀占用磁盘空间。

## Chosen Approach

采用“按会话最后活跃时间删除整段会话”的策略，并提供 `永久保留` 选项。

选择这个方案的原因：

- 语义对用户最直观：超过保留期的旧聊天整个消失，不会留下只有标题没有内容的空壳。
- 实现边界最干净：`conversation_session` 与其子表已有 `ON DELETE CASCADE`，清理整段会话时更不容易留下 summary/job/idle task 残留。
- 对磁盘增长的控制最有效：不仅消息表会收缩，相关 summary/job 元数据也会一起清理。

## Data Flow

1. 设置页 `AgentSettingsCard` 在桌面端读取并保存一个新的 `desktop_config` 键，例如 `chat.history_retention_days`。
2. 配置值使用字符串持久化，前端用固定选项渲染：`永久保留`、`7 天`、`30 天`、`90 天`、`180 天`、`365 天`。
3. 桌面启动后已有的 `start_local_periodic_worker` 每分钟运行一次；在这条现有周期任务中增加“按保留期清理会话”的分支。
4. 周期 worker 每次执行时读取 retention 配置：
   - 未配置、空值、`0` 或非法值：视为 `永久保留`，不删除。
   - 合法正整数：计算阈值时间，删除 `last_active_at` 早于阈值的本地会话。
5. 删除会话时直接删除 `conversation_session`，依赖外键级联移除 `conversation_message`、`conversation_summary`、`conversation_summary_job`、`conversation_summary_idle_task`。

## Operational Semantics

- 判定依据：`conversation_session.last_active_at`
- 清理单位：整段会话
- 默认行为：`永久保留`
- 生效范围：仅当前桌面端当前设备
- 执行时机：桌面启动后的本地 periodic worker 周期扫描

## Edge Cases

- 非桌面端不显示此设置。
- 历史配置缺失时保持兼容，不触发删除。
- 清理过程中如果某轮出现数据库错误，只记录 periodic task failure，不影响下一轮重试。
- 使用整段会话删除而不是软删除，避免“消息删了但会话/摘要还在”的状态漂移。

## Verification Plan

- 前端测试：验证设置卡会读取 retention 配置、用户修改后会保存新键。
- Rust 测试：验证配置为 `7` 天时，会删除过期会话、保留近期会话与永久保留配置下的会话。
- 最后跑相关 Jest、Rust test、以及变更文件诊断。

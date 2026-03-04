# 桌面端本地聊天「停止 / 继续」烟测清单（3 分钟）

## 目标
- 验证桌面端本地路径中，点击停止会真实终止当前请求。
- 验证停止后点击继续，可基于当前会话继续生成（regenerate）。

## 前置条件
- 运行桌面端（Tauri）应用。
- 已配置可用的本地 Provider / Model（`request_route=local_invoke`）。
- 进入任意聊天会话页面。

## 用例 1：发送中手动停止
1. 输入一段会触发较长回复的问题（例如“请分 20 点详细说明 ...”）。
2. 点击发送后，在回复流式输出期间点击停止按钮（方块图标）。
3. 观察 UI 状态与消息列表。

预期：
- 按钮从“停止”恢复到“继续/发送”状态。
- 当前 assistant 消息不再继续增长。
- 不出现新的报错气泡（不应显示“Request failed”）。

## 用例 2：停止后继续生成
1. 在用例 1 停止后，点击“继续”按钮。
2. 观察 assistant 消息是否重新生成并完成。

预期：
- 触发新的生成流程。
- 会话保持在原 `session_id` 上继续。
- 生成完成后，消息可正常落库并可刷新后看到。

## 用例 3：再生成路径停止/继续
1. 对一条 assistant 消息执行“重新生成”。
2. 生成中点击停止。
3. 再点击继续。

预期：
- 重新生成流程可被中断。
- 继续后可再次完成生成。
- 不出现重复错误块或 UI 卡死。

## 快速回归命令
```bash
# Rust 单测
cd deeting/src-tauri && cargo test --lib

# 前端 API 相关测试（含本地取消命令）
cd deeting && npm test -- --runInBand lib/api/__tests__/conversations-mutations.test.ts

# 控件层测试（继续按钮）
cd deeting && npm test -- --runInBand components/chat/console/__tests__/controls-container.test.tsx
```


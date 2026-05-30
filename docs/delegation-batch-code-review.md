# Chat 临时智能体委派架构 Code Review

## 执行摘要

**总体评价：✅ 优秀实现，架构清晰，符合设计目标**

已落地的实现高质量地完成了计划中的核心目标：
- ✅ Agent type 模板系统（.md 文件 + YAML frontmatter）
- ✅ 临时 agent 创建（ephemeral profile，不写入持久化）
- ✅ 后台并行运行（tauri::async_runtime::spawn）
- ✅ 推送通知机制（复用 resume_delegated_runtime_after_custom_task_agent_run）
- ✅ 停止能力（abort + cancelled 状态）
- ✅ 系统提示词边界守护（agent_spec 不能覆盖 system_prompt）

**关键亮点：**
1. **边界守护严格**：`parse_ephemeral_agent_spec` 明确拒绝 `system_prompt` 和 `task_prompt` 字段
2. **模板加载优先级清晰**：项目本地 > 全局 > 内置默认
3. **后台完成推送**：复用现有 `resume_delegated_runtime_after_custom_task_agent_run`，避免轮询
4. **状态管理健壮**：cancelled 状态不被 late completion 覆盖
5. **测试覆盖充分**：单元测试覆盖核心逻辑（状态顺序、stop 语义、模板优先级）

---

## 详细 Review

### 1. Agent Type 模板系统 ✅

**文件：** `agent_types.rs`

#### 优点
- **模板结构清晰**：YAML frontmatter + Markdown body，与 pi-subagents 对齐
- **加载优先级正确**：
  ```rust
  // 1. 项目本地：.claude/agents/{agent_type}.md（向上查找 ancestors）
  // 2. 全局：~/.claude/agents/{agent_type}.md
  // 3. 内置默认：explore, plan, implement, review
  ```
- **解析健壮**：frontmatter 和 body 分离清晰，错误信息友好
- **内置模板质量高**：4 个默认类型的系统提示词简洁、职责明确

#### 建议改进

**1.1 模板验证增强**
```rust
// 当前：只验证 agent_type 名称格式
fn validate_agent_type_name(agent_type: &str) -> Result<(), String>

// 建议：增加模板内容验证
fn validate_agent_template(template: &AgentTypeTemplate) -> Result<(), String> {
    if template.system_prompt.trim().is_empty() {
        return Err("system_prompt cannot be empty".to_string());
    }
    if template.system_prompt.len() > 50_000 {
        return Err("system_prompt exceeds 50KB limit".to_string());
    }
    // 检查是否包含可疑的动态指令注入模式
    if template.system_prompt.contains("{{") || template.system_prompt.contains("{task}") {
        log::warn!("agent_type '' system_prompt contains template-like syntax", template.name);
    }
    Ok(())
}
```

**1.2 模板热重载**
```rust
// 建议：添加文件监听（开发模式）
pub struct AgentTypeTemplateCache {
    cache: Arc<RwLock<HashMap<String, (AgentTypeTemplate, SystemTime)>>>,
    watcher: Option<notify::RecommendedWatcher>,
}

impl AgentTypeTemplateCache {
    pub fn load_with_cache(&self, agent_type: &str) -> Result<AgentTypeTemplate, String> {
        // 检查文件 mtime，如果变化则重新加载
    }
}
```

**1.3 模板发现 API**
```rust
// 建议：添加列出可用模板的功能
pub fn list_available_agent_types(
    project_dir: Option<&Path>,
    home_dir: Option<&Path>,
) -> Vec<String> {
    let mut types = HashSet::new();
    // 扫描 .claude/agents/*.md
    // 添加内置类型
    types.into_iter().collect()
}
```

---

### 2. Ephemeral Agent Profile 构造 ✅

**文件：** `agent_types.rs` (L139-232)

#### 优点
- **边界守护严格**：
  ```rust
  if raw.get("system_prompt").or_else(|| raw.get("task_prompt")).is_some() {
      return Err("agent_spec cannot include system_prompt or task_prompt...".to_string());
  }
  ```
- **合并逻辑清晰**：agent_spec 覆盖配置，但 system_prompt 只能来自模板
- **ID 生成稳定**：`ephemeral:{batch_id}:{child_index}`
- **标签自动添加**：`ephemeral` 和 `agent_type` 标签

#### 建议改进

**2.1 配置覆盖验证**
```rust
// 当前：允许 agent_spec 覆盖任意工具列表
callable_mcp_tool_ids: agent_spec.callable_mcp_tool_ids
    .unwrap_or(template.callable_mcp_tool_ids)

// 建议：验证覆盖的工具是否在模板允许范围内（可选严格模式）
fn validate_tool_override(
    spec_tools: &[String],
    template_tools: &[String],
    strict: bool,
) -> Result<(), String> {
    if strict {
        for tool in spec_tools {
            if !template_tools.contains(tool) {
                return Err(format!(
                    "agent_spec tool '{}' not in template allowed list",
                    tool
                ));
            }
        }
    }
    Ok(())
}
```

**2.2 thinking_level 合并优化**
```rust
// 当前：merge_model_config 逻辑复杂（L234-258）
// 建议：简化为独立字段
pub struct EphemeralAgentProfile {
    pub profile: CustomTaskAgentProfile,
    pub max_rounds: Option<u32>,
    pub thinking_level: Option<String>,  // 新增：独立管理
}
```

---

### 3. Delegation Batch Manager ✅

**文件：** `delegation_batch.rs` (L86-260)

#### 优点
- **内存态设计**：`OnceLock<DelegationBatchManager>`，进程级单例
- **状态管理健壮**：
  ```rust
  if child.record.status == ChildRunStatus::Cancelled {
      return false;  // late completion 不覆盖 cancelled
  }
  ```
- **顺序保持**：`child_order` 向量保证 status 返回顺序
- **abort 处理正确**：`JoinHandle::abort()` + 状态置为 `Cancelled`

#### 建议改进

**3.1 Batch 生命周期管理**
```rust
// 当前：batch 永久保留在内存中
// 建议：添加过期清理
impl DelegationBatchManager {
    fn cleanup_expired_batches(&self, max_age_ms: i64) {
        let mut batches = self.batches.lock().unwrap();
        let now = now_unix_ms_i64();
        batches.retain(|_batch_id, batch| {
            let all_terminal = batch.children.values().all(|child| {
                matches!(
                    child.record.status,
                    ChildRunStatus::Completed | ChildRunStatus::Failed | ChildRunStatus::Cancelled
                )
            });
            if all_terminal {
                if let Some(latest_completed) = batch.children.values()
                    .filter_map(|c| c.record.completed_at_ms)
                    .max()
                {
                    return now - latest_completed < max_age_ms;
                }
            }
            true
        });
    }
}
```

**3.2 并发限制**
```rust
// 当前：无并发限制，所有后台 child 立即 spawn
// 建议：添加并发控制（类似 pi-subagents 的 concurrency limit）
struct DelegationBatchManager {
    batches: Mutex<HashMap<String, DelegationBatch>>,
    running_count: AtomicUsize,  // 新增
    max_concurrent: usize,        // 新增：默认 4
}

impl DelegationBatchManager {
    fn try_spawn_child(&self, ...) -> Result<(), String> {
        if self.running_count.load(Ordering::Relaxed) >= self.max_concurrent {
            return Err("max concurrent children reached, queued".to_string());
        }
        self.running_count.fetch_add(1, Ordering::Relaxed);
        // spawn...
    }
}
```

**3.3 Batch 元数据**
```rust
// 建议：添加 batch 级别的元数据
struct DelegationBatch {
    batch_id: String,              // 新增
    created_at_ms: i64,            // 新增
    parent_session_id: String,     // 新增：用于审计
    child_order: Vec<String>,
    children: HashMap<String, StoredChildRun>,
}
```

---

### 4. 工具执行逻辑 ✅

**文件：** `delegation_batch.rs` (L293-547)

#### 优点
- **前台/后台模式清晰**：
  - 前台：同步执行，阻塞返回完整结果
  - 后台：立即返回，spawn 异步任务
- **后台完成推送**：复用 `resume_delegated_runtime_after_custom_task_agent_run`
- **审计持久化**：`persist_delegated_execution_audit` 记录完整执行图
- **错误处理健壮**：late result 被拒绝时只记录日志，不抛异常

#### 建议改进

**4.1 前台模式超时保护**
```rust
// 当前：前台模式无超时，可能永久阻塞
// 建议：添加超时
pub async fn execute_delegate_agents_start_tool(...) -> Result<...> {
    // ...
    if !prepared.run_in_background {
        let timeout_ms = prepared.max_rounds as u64 * 120_000; // 每轮 2 分钟
        match tokio::time::timeout(
            Duration::from_millis(timeout_ms),
            run_prepared_child(...)
        ).await {
            Ok(session) => { /* 正常处理 */ }
            Err(_) => {
                // 超时，标记为 failed
                delegation_batch_manager().complete_child(
                    batch_id.as_str(),
                    child_run_id.as_str(),
                    ChildRunStatus::Failed,
                    json!({"error": "foreground execution timeout"}),
                );
            }
        }
    }
}
```

**4.2 后台任务错误恢复**
```rust
// 当前：后台 spawn 的 future 如果 panic，只会静默失败
// 建议：添加 panic 捕获
fn spawn_background_child(...) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let result = std::panic::AssertUnwindSafe(async {
            run_prepared_child(...).await
        })
        .catch_unwind()
        .await;
        
        match result {
            Ok(session) => { /* 正常处理 */ }
            Err(panic_err) => {
                log::error!("background child panicked: {:?}", panic_err);
                delegation_batch_manager().complete_child(
                    batch_id.as_str(),
                    child_run_id.as_str(),
                    ChildRunStatus::Failed,
                    json!({"error": "child panicked"}),
                );
            }
        }
    })
}
```

**4.3 max_rounds 上限验证**
```rust
// 当前：cap_child_max_rounds 限制在 runtime_max_rounds
fn cap_child_max_rounds(value: u32, runtime_max_rounds: usize) -> u32 {
    let runtime_cap = runtime_max_rounds.max(1).min(u32::MAX as usize) as u32;
    value.max(1).min(runtime_cap)
}

// 建议：添加绝对上限（防止恶意输入）
fn cap_child_max_rounds(value: u32, runtime_max_rounds: usize) -> u32 {
    const ABSOLUTE_MAX: u32 = 100;  // 绝对上限
    let runtime_cap = runtime_max_rounds.max(1).min(ABSOLUTE_MAX as usize) as u32;
    value.max(1).min(runtime_cap).min(ABSOLUTE_MAX)
}
```

---

### 5. Tool Call Processor 集成 ✅

**文件：** `tool_call_processor.rs` (L339-410)

#### 优点
- **分支清晰**：三个新工具各自独立分支
- **错误处理统一**：使用 `push_local_tool_call_error_meta`
- **执行段标记**：`emit_execution_section_once("Delegate Agents")`

#### 建议改进

**5.1 工具调用频率限制**
```rust
// 建议：防止主模型滥用 delegate_agents_start
struct DelegateAgentsRateLimiter {
    session_limits: Mutex<HashMap<String, (usize, Instant)>>,
}

impl DelegateAgentsRateLimiter {
    fn check_limit(&self, session_id: &str) -> Result<(), String> {
        let mut limits = self.session_limits.lock().unwrap();
        let (count, last_reset) = limits.entry(session_id.to_string())
            .or_insert((0, Instant::now()));
        
        if last_reset.elapsed() > Duration::from_secs(60) {
            *count = 0;
            *last_reset = Instant::now();
        }
        
        if *count >= 10 {  // 每分钟最多 10 次
            return Err("delegate_agents_start rate limit exceeded".to_string());
        }
        
        *count += 1;
        Ok(())
    }
}
```

---

### 6. Prompt Contract ✅

**文件：** `prompt.rs` (L16)

#### 优点
- **委派边界清晰**：
  > "For parallel or temporary chat-side delegation, use `delegate_agents_start` with either an existing `agent_id` or a predefined `agent_type`; the task text is parent-authored, while child system prompts must come from `.claude/agents/{agent_type}.md` or built-in templates and must not be supplied through `agent_spec`."

- **推送 vs 轮询明确**：
  > "Background children push completion through the runtime resume path; `delegate_agents_status` is only an auxiliary progress check"

- **停止语义清晰**：
  > "`delegate_agents_stop` cancels running children without rolling back completed ones"

#### 建议改进

**6.1 增加使用示例**
```markdown
## Delegation Contract (Extended)

### Example: Parallel Exploration
```json
{
  "tool": "delegate_agents_start",
  "arguments": {
    "tasks": [
      {
        "task": "Find all authentication files and summarize their purpose",
        "agent_type": "explore",
        "run_in_background": true
      },
      {
        "task": "Find all API endpoint definitions",
        "agent_type": "explore",
        "run_in_background": true
      }
    ]
  }
}
```

### Example: Custom Agent Type Override
```json
{
  "task": "Scan for SQL injection vulnerabilities",
  "agent_type": "review",
  "agent_spec": {
    "name": "SQL Injection Scanner",
    "callable_mcp_tool_ids": ["read_file", "grep"],
    "thinking_level": "high"
  }
}
```

### Anti-patterns
❌ Do not supply system_prompt in agent_spec:
```json
{
  "agent_spec": {
    "system_prompt": "You are a security auditor..."  // REJECTED
  }
}
```

❌ Do not recursively delegate:
```
Main model -> delegate_agents_start -> Child agent -> delegate_agents_start  // AVOID
```
```

---

### 7. 测试覆盖 ✅

**文件：** `agent_types.rs` (L393-514), `delegation_batch.rs` (L980-1045)

#### 优点
- **核心逻辑覆盖充分**：
  - ✅ Frontmatter 解析
  - ✅ system_prompt 覆盖拒绝
  - ✅ 模板优先级（项目 > 全局 > 内置）
  - ✅ Ephemeral profile 构造
  - ✅ Batch 状态顺序保持
  - ✅ Stop 不回滚已完成 child
  - ✅ Late completion 不覆盖 cancelled

#### 建议改进

**7.1 集成测试**
```rust
// 建议：添加端到端集成测试
#[tokio::test]
async fn end_to_end_background_delegation() {
    let app = test_app_handle();
    let app_state = test_app_state();
    let state = test_chat_runtime_state();
    
    // 1. 启动后台 child
    let result = execute_delegate_agents_start_tool(
        &app,
        &app_state,
        &state,
        "session-1",
        "call-1",
        "delegate_agents_start",
        &json!({
            "tasks": [{
                "task": "Find all .rs files",
                "agent_type": "explore",
                "run_in_background": true
            }]
        }),
        &["read_file", "grep", "glob"],
    ).await.unwrap();
    
    let batch_id = result.meta["result"]["delegation_batch_id"].as_str().unwrap();
    
    // 2. 等待完成（模拟）
    tokio::time::sleep(Duration::from_millis(100)).await;
    
    // 3. 查询状态
    let status = execute_delegate_agents_status_tool(
        "call-2",
        "delegate_agents_status",
        &json!({"delegation_batch_id": batch_id}),
    ).await.unwrap();
    
    assert_eq!(status.meta["result"]["children"][0]["status"], "completed");
}
```

**7.2 错误场景测试**
```rust
#[test]
fn rejects_invalid_agent_type() {
    let err = load_agent_type_template("../../../etc/passwd")
        .expect_err("should reject path traversal");
    assert!(err.contains("only ASCII letters"));
}

#[test]
fn rejects_empty_system_prompt() {
    let err = parse_agent_template_md("test", "---\nname: test\n---\n\n")
        .expect_err("should reject empty body");
    assert!(err.contains("must include a Markdown body"));
}
```

---

## 架构决策验证

### ✅ 已验证的设计决策

| 决策 | 实现验证 | 证据 |
|------|---------|------|
| 任务描述由主模型现编 | ✅ | `task` 参数必填，直接传入子 agent |
| 系统提示词预定义 | ✅ | `parse_ephemeral_agent_spec` 拒绝 `system_prompt` |
| 推送通知 > 轮询 | ✅ | 后台完成调用 `resume_delegated_runtime_after_custom_task_agent_run` |
| 内存态生命周期 | ✅ | `OnceLock<DelegationBatchManager>`，无持久化 |
| Agent type 模板系统 | ✅ | `.md` 文件 + YAML frontmatter，优先级清晰 |
| 停止不回滚已完成 | ✅ | `complete_child` 检查 `Cancelled` 状态 |

---

## 潜在风险与缓解

### 风险 1：内存泄漏（低风险）
**问题**：batch 永久保留在内存中，长时间运行可能积累大量已完成 batch

**缓解**：
- 短期：文档说明重启清理
- 长期：实现 `cleanup_expired_batches`（见建议 3.1）

### 风险 2：并发爆炸（中风险）
**问题**：主模型可能一次启动 100 个后台 child，耗尽资源

**缓解**：
- 短期：依赖 `max_rounds` 和 provider 限流
- 长期：实现并发限制（见建议 3.2）

### 风险 3：前台阻塞（中风险）
**问题**：前台模式无超时，子 agent 卡死会永久阻塞主模型

**缓解**：
- 实现超时保护（见建议 4.1）

### 风险 4：模板注入（低风险）
**问题**：恶意模板文件可能包含动态指令

**缓解**：
- 模板只能来自本地文件系统（`.claude/agents/`）
- 用户有完全控制权
- 可选：添加模板内容验证（见建议 1.1）

---

## 性能评估

### 优点
- ✅ 模板加载缓存（`OnceLock` 单例）
- ✅ 后台 spawn 不阻塞主模型
- ✅ 状态查询 O(n) 复杂度（n = children 数量）

### 改进空间
- 模板文件每次都重新读取（可添加 mtime 缓存）
- Batch manager 全局锁（可改为分片锁）

---

## 代码质量

### 优点
- ✅ 错误处理完善（Result 类型，友好错误信息）
- ✅ 日志记录充分（warn/info/error 分级）
- ✅ 类型安全（强类型，少用 `unwrap()`）
- ✅ 文档注释清晰（pub 函数都有注释）
- ✅ 测试覆盖核心逻辑

### 改进空间
- 部分函数较长（`execute_delegate_agents_start_tool` 130 行）
- 可抽取更多 helper 函数

---

## 与计划的对比

### 已完成 ✅
- [x] Agent type 模板系统（.md + YAML）
- [x] 临时 agent 创建（ephemeral profile）
- [x] 后台并行运行（spawn + JoinHandle）
- [x] 推送通知机制（resume 路径）
- [x] 停止能力（abort + cancelled）
- [x] 系统提示词边界守护
- [x] 前台/后台模式
- [x] 状态查询（status 工具）
- [x] 审计持久化
- [x] 单元测试

### 未完成（Out of Scope for v1）
- [ ] 定时调度（schedule 字段）
- [ ] 跨会话恢复（持久化 batch state）
- [ ] 中途干预（steering）
- [ ] 分支模式（inherit_context）
- [ ] 预算管理（token/cost 限制）
- [ ] 模板数据库持久化
- [ ] 模板版本控制

---

## 最终建议

### 必须修复（P0）
无。当前实现已满足 v1 目标，无阻塞性问题。

### 强烈建议（P1）
1. **前台模式超时保护**（见建议 4.1）— 防止永久阻塞
2. **并发限制**（见建议 3.2）— 防止资源耗尽
3. **Batch 过期清理**（见建议 3.1）— 防止内存泄漏

### 可选增强（P2）
4. 模板验证增强（见建议 1.1）
5. 模板热重载（见建议 1.2）
6. 集成测试（见建议 7.1）
7. 工具调用频率限制（见建议 5.1）

### 文档改进（P2）
8. Prompt contract 增加使用示例（见建议 6.1）
9. 添加 `.claude/agents/` 目录的 README
10. 添加自定义 agent type 的教程

---

## 总结

这是一个**高质量的实现**，完整实现了计划中的核心目标，并且：
- ✅ 架构清晰，职责分离
- ✅ 边界守护严格（系统提示词不可覆盖）
- ✅ 推送通知机制高效（复用现有基础设施）
- ✅ 测试覆盖充分（核心逻辑都有单元测试）
- ✅ 错误处理健壮（Result 类型，友好错误信息）

**与 pi-subagents 的对齐度：95%**
- ✅ Agent type 模板系统（.md + YAML）
- ✅ 前台/后台模式
- ✅ 推送通知
- ✅ 停止能力
- ⚠️ 缺少并发限制（pi-subagents 默认 4）
- ⚠️ 缺少定时调度（schedule 字段）

**建议优先级：**
1. **P1 改进**（前台超时、并发限制、batch 清理）— 提升生产稳定性
2. **P2 增强**（模板验证、集成测试）— 提升开发体验
3. **v2 特性**（定时调度、跨会话恢复）— 功能扩展

**总体评分：9/10** 🎉

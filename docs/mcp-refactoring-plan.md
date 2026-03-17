# MCP 模块生产级拆分迁移计划

## 📊 现状分析

### 1.1 模块规模统计

| 指标 | 数值 |
|------|------|
| **总文件数** | 94 个 |
| **Rust 源文件** | ~90 个 |
| **总代码行数** | ~30,000+ 行 |
| **最大文件** | 4567 行 (store/conversations.rs) |

### 1.2 目录结构现状

```
mcp/
├── 核心层 (10文件) - 状态管理、类型定义、错误处理
├── bridge层 (3文件) - 后端桥接
├── process层 (3文件) - 进程管理
├── gateway层 (1文件) - 本地网关
├── orchestrator层 (1文件) - 工作流编排
├── commands层 (33文件) - 命令接口
├── store层 (15文件) - 数据存储
└── risk层 (1文件) - 风险评估
```

### 1.3 核心问题

1. **职责混杂**：单个模块承载过多功能（90+文件）
2. **循环依赖风险**：McpRuntimeState 聚合了所有子模块
3. **编译时间长**：所有代码在同一 crate，无法并行编译
4. **测试困难**：模块间紧耦合，单元测试难以隔离
5. **团队协作冲突**：多人同时修改同一目录

---

## 🏗️ 目标架构设计

### 2.1 模块划分原则

采用**领域驱动设计(DDD)** + **分层架构**混合模式：

1. **垂直拆分**：按业务领域（Domain）划分
2. **水平分层**：每个领域内部分层（API/Service/Infra）
3. **依赖倒置**：核心不依赖实现，实现依赖核心

### 2.2 目标架构

```
 crates/
 ├── mcp-core/                    # 核心领域层
 │   ├── src/
 │   │   ├── lib.rs              # 核心导出
 │   │   ├── types/              # 领域类型
 │   │   │   ├── mod.rs
 │   │   │   ├── tool.rs
 │   │   │   ├── source.rs
 │   │   │   ├── assistant.rs
 │   │   │   ├── conversation.rs
 │   │   │   └── skill.rs
 │   │   ├── error.rs            # 统一错误类型
 │   │   ├── protocol.rs         # MCP协议定义
 │   │   └── traits/             # 核心抽象
 │   │       ├── storage.rs      # 存储抽象
 │   │       ├── transport.rs    # 传输抽象
 │   │       └── runtime.rs      # 运行时抽象
 │   └── Cargo.toml
 │
 ├── mcp-storage/                 # 存储实现层
 │   ├── src/
 │   │   ├── lib.rs
 │   │   ├── connection.rs       # 数据库连接
 │   │   ├── repositories/       # 仓储实现
 │   │   │   ├── assistants.rs
 │   │   │   ├── conversations.rs
 │   │   │   ├── sources.rs
 │   │   │   └── tools.rs
 │   │   └── migrations/         # 数据库迁移
 │   └── Cargo.toml
 │
 ├── mcp-transport/               # 传输层
 │   ├── src/
 │   │   ├── lib.rs
 │   │   ├── gateway.rs          # 本地网关服务器
 │   │   ├── bridge/             # 后端桥接
 │   │   │   ├── mod.rs
 │   │   │   ├── state.rs
 │   │   │   └── streaming.rs
 │   │   └── protocol/           # 协议处理
 │   └── Cargo.toml
 │
 ├── mcp-runtime/                 # 运行时层
 │   ├── src/
 │   │   ├── lib.rs
 │   │   ├── process/            # 进程管理
 │   │   │   ├── mod.rs
 │   │   │   ├── manager.rs
 │   │   │   └── backoff.rs
 │   │   ├── orchestrator/       # 编排引擎
 │   │   │   ├── mod.rs
 │   │   │   ├── engine.rs
 │   │   │   └── steps/          # 工作流步骤
 │   │   └── execution/          # 执行引擎
 │   └── Cargo.toml
 │
 ├── mcp-tools/                   # 工具管理层
 │   ├── src/
 │   │   ├── lib.rs
 │   │   ├── registry.rs         # 工具注册表
 │   │   ├── risk.rs             # 风险评估
 │   │   ├── execution.rs        # 工具执行
 │   │   ├── skills/             # Skill管理
 │   │   │   ├── mod.rs
 │   │   │   ├── registry.rs
 │   │   │   ├── install.rs
 │   │   │   └── sync.rs
 │   │   └── sources/            # 源管理
 │   └── Cargo.toml
 │
 ├── mcp-session/                 # 会话管理层
 │   ├── src/
 │   │   ├── lib.rs
 │   │   ├── conversations.rs    # 对话管理
 │   │   ├── assistants.rs       # 助手管理
 │   │   ├── chat/               # 聊天功能
 │   │   └── admin/              # 管理功能
 │   └── Cargo.toml
 │
 └── mcp-facade/                  # 外观层（对外暴露）
     ├── src/
     │   ├── lib.rs
     │   ├── runtime.rs          # McpRuntimeState
     │   └── commands/           # Tauri命令封装
     └── Cargo.toml
```

### 2.3 依赖关系图

```
                  ┌─────────────────┐
                  │   mcp-facade    │  ← 对外API
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
 ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
 │ mcp-session │   │  mcp-tools   │   │ mcp-runtime │
 └──────┬──────┘   └──────┬───────┘   └──────┬──────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
 ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
 │mcp-transport│   │ mcp-storage  │   │  mcp-core   │
 └─────────────┘   └──────────────┘   └──────┬──────┘
                                             │
                                      ┌──────┴──────┐
                                      │   lib-sql   │
                                      └─────────────┘
```

---

## 📋 分阶段迁移计划

### Phase 0: 准备阶段（1-2天）

**目标**：建立迁移基础，确保迁移过程可追踪

#### 任务清单

- [ ] 创建 `crates/` 目录结构
- [ ] 配置 workspace `Cargo.toml`
- [ ] 设置 CI/CD 检查
- [ ] 创建迁移跟踪 Issue
- [ ] 准备代码覆盖率基线

#### 详细步骤

```bash
# 1. 创建 crates 目录
mkdir -p crates/{mcp-core,mcp-storage,mcp-transport,mcp-runtime,mcp-tools,mcp-session,mcp-facade}/src

# 2. 创建各 crate 基础文件
for crate in mcp-core mcp-storage mcp-transport mcp-runtime mcp-tools mcp-session mcp-facade; do
  touch crates/$crate/src/lib.rs
  touch crates/$crate/Cargo.toml
done

# 3. 更新根目录 Cargo.toml
```

**根目录 Cargo.toml 更新**：
```toml
[workspace]
members = [
    "crates/mcp-core",
    "crates/mcp-storage",
    "crates/mcp-transport",
    "crates/mcp-runtime",
    "crates/mcp-tools",
    "crates/mcp-session",
    "crates/mcp-facade",
]
resolver = "2"

[workspace.dependencies]
# 共享依赖版本管理
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1.35", features = ["full"] }
# ... 其他依赖
```

---

### Phase 1: 提取 mcp-core（3-4天）

**风险等级**: 🟢 低  
**依赖**: 无  
**回滚难度**: 易

#### 目标
- 提取所有核心类型定义
- 建立存储、传输、运行时抽象 trait
- 确保零业务逻辑，仅类型和接口

#### 文件映射

| 源文件 | 目标位置 | 操作 |
|--------|----------|------|
| `modules/mcp/types.rs` | `mcp-core/src/types/mod.rs` | 移动+拆分 |
| `modules/mcp/error.rs` | `mcp-core/src/error.rs` | 移动 |
| `modules/mcp/store/mod.rs` (trait部分) | `mcp-core/src/traits/storage.rs` | 提取 |
| `modules/mcp/bridge.rs` (trait部分) | `mcp-core/src/traits/transport.rs` | 提取 |

#### 具体步骤

```bash
# 步骤 1: 创建核心类型
cat > crates/mcp-core/src/types/mod.rs << 'EOF'
//! MCP Core Types
//! 
//! 本模块包含所有MCP领域类型定义。
//! 注意：这里只有数据结构，没有业务逻辑。

pub mod tool;
pub mod source;
pub mod assistant;
pub mod conversation;
pub mod skill;

// 重新导出常用类型
pub use tool::{McpTool, McpToolStatus, McpToolInputSchema};
pub use source::{McpSource, McpSourceType, McpServer};
pub use assistant::{LocalAssistant, LocalAssistantRoute};
pub use conversation::{LocalConversation, LocalMessage};
pub use skill::{Skill, SkillManifest, SkillRuntime};
EOF

# 步骤 2: 从原 types.rs 拆分到各子模块
# 详见迁移脚本部分
```

#### 验证清单

- [ ] `cargo check -p mcp-core` 通过
- [ ] 所有类型能被正确导出
- [ ] 单元测试 `cargo test -p mcp-core` 通过
- [ ] 文档生成 `cargo doc -p mcp-core` 无警告

---

### Phase 2: 提取 mcp-storage（4-5天）

**风险等级**: 🟡 中  
**依赖**: mcp-core  
**回滚难度**: 中

#### 目标
- 将数据访问层独立为 crate
- 实现 Storage trait
- 保持与现有数据库模式兼容

#### 文件映射

| 源文件 | 目标位置 | 备注 |
|--------|----------|------|
| `store/mod.rs` | `src/lib.rs` | 适配 |
| `store/assistants.rs` | `src/repositories/assistants.rs` | 移动 |
| `store/conversations.rs` | `src/repositories/conversations.rs` | 移动 |
| `store/source_tools.rs` | `src/repositories/sources.rs` | 拆分 |
| `store_parts/*.rs` | `src/internal/` | 合并 |

#### 重构策略

由于存储层文件较大（4000+行），采用**渐进式提取**：

```rust
// crates/mcp-storage/src/lib.rs
pub mod repositories;
pub mod connection;

use mcp_core::traits::storage::Storage;

pub struct SqliteStorage {
    pool: SqlitePool,
}

impl Storage for SqliteStorage {
    // 实现存储 trait
}
```

#### 数据库兼容性保证

```sql
-- 验证现有表结构不变
-- 迁移脚本必须保持向后兼容
-- 新增表/字段使用迁移文件管理
```

#### 验证清单

- [ ] 所有存储测试通过
- [ ] 数据库文件兼容（新老版本都能读写）
- [ ] 性能测试无退化

---

### Phase 3: 提取 mcp-transport（3-4天）

**风险等级**: 🟡 中  
**依赖**: mcp-core  
**回滚难度**: 中

#### 目标
- 网关服务器独立
- 桥接层重构
- SSE 流处理优化

#### 文件映射

| 源文件 | 目标位置 | 操作 |
|--------|----------|------|
| `gateway.rs` | `src/gateway.rs` | 移动 |
| `bridge.rs` | `src/bridge/mod.rs` | 重构 |
| `bridge_parts/*.rs` | `src/bridge/*.rs` | 拆分 |

#### 关键重构点

```rust
// 原代码：直接依赖具体实现
// 新代码：依赖 trait，便于测试和Mock

use mcp_core::traits::transport::Transport;

pub struct GatewayServer<T: Transport> {
    transport: T,
}
```

---

### Phase 4: 提取 mcp-runtime（5-6天）

**风险等级**: 🟠 中高  
**依赖**: mcp-core, mcp-transport  
**回滚难度**: 中高

#### 目标
- 进程管理独立
- 编排引擎重构
- 执行平面解耦

#### 文件映射

| 源目录/文件 | 目标位置 | 操作 |
|-------------|----------|------|
| `process.rs` + `process_parts/` | `src/process/` | 合并重构 |
| `local_orchestrator.rs` | `src/orchestrator/` | 拆分 |
| `commands/runtime/*.rs` | `src/execution/` | 迁移 |

#### 复杂性处理

`commands/runtime/` 包含 25 个文件，需要按功能分组：

```
src/execution/
├── mod.rs
├── capabilities/          # 能力相关
│   ├── discovery.rs
│   ├── registry.rs
│   └── activation.rs
├── chat/                  # 聊天功能
│   ├── completion.rs
│   └── routing.rs
├── tools/                 # 工具执行
│   ├── execution.rs
│   ├── resolution.rs
│   └── feedback.rs
├── workers/               # 后台工作器
│   ├── background.rs
│   └── summary.rs
└── code_mode/             # 代码模式
    ├── catalog.rs
    └── orchestration.rs
```

---

### Phase 5: 提取 mcp-tools（4-5天）

**风险等级**: 🟡 中  
**依赖**: mcp-core, mcp-runtime  
**回滚难度**: 中

#### 目标
- Skill 管理独立
- 工具注册表重构
- 风险评估保留

#### 文件映射

| 源文件 | 目标位置 | 操作 |
|--------|----------|------|
| `risk.rs` | `src/risk.rs` | 移动 |
| `commands/skills.rs` | `src/skills/mod.rs` | 重构 |
| `commands_parts/skill_registry*.rs` | `src/skills/` | 拆分 |
| `commands/sources.rs` | `src/sources/mod.rs` | 重构 |
| `commands_parts/source_management.rs` | `src/sources/management.rs` | 移动 |

---

### Phase 6: 提取 mcp-session（4-5天）

**风险等级**: 🟡 中  
**依赖**: mcp-core, mcp-storage  
**回滚难度**: 中

#### 目标
- 对话管理独立
- 助手管理独立
- 管理功能独立

#### 文件映射

| 源文件 | 目标位置 | 操作 |
|--------|----------|------|
| `commands/conversations.rs` | `src/conversations.rs` | 重构 |
| `commands/assistants.rs` | `src/assistants.rs` | 重构 |
| `commands/admin.rs` | `src/admin/mod.rs` | 拆分 |
| `commands_parts/*_management.rs` | `src/` | 分布 |

---

### Phase 7: 创建 mcp-facade（3-4天）

**风险等级**: 🟠 中高  
**依赖**: 所有子 crate  
**回滚难度**: 高

#### 目标
- 整合所有子 crate
- 提供统一对外接口
- 替换原有 McpRuntimeState

#### 重构策略

```rust
// crates/mcp-facade/src/runtime.rs
use mcp_core::types::*;
use mcp_storage::SqliteStorage;
use mcp_transport::{GatewayServer, BridgeClient};
use mcp_runtime::{ProcessManager, Orchestrator};
use mcp_tools::{ToolRegistry, SkillManager};
use mcp_session::{ConversationManager, AssistantManager};

/// 重构后的 McpRuntimeState
pub struct McpRuntimeState {
    pub storage: Arc<dyn Storage>,
    pub process_manager: ProcessManager,
    pub transport: TransportLayer,
    pub runtime: RuntimeLayer,
    pub tools: ToolsLayer,
    pub session: SessionLayer,
}
```

---

### Phase 8: 清理与迁移（2-3天）

**风险等级**: 🟢 低  
**依赖**: 全部  
**回滚难度**: 低

#### 任务
- [ ] 删除原 `modules/mcp/` 目录
- [ ] 更新所有 import 路径
- [ ] 运行完整测试套件
- [ ] 性能回归测试
- [ ] 文档更新

---

## ⏱️ 时间规划

| 阶段 | 预计工期 | 并行度 | 缓冲 |
|------|----------|--------|------|
| Phase 0 | 1-2天 | - | 0.5天 |
| Phase 1 | 3-4天 | - | 1天 |
| Phase 2 | 4-5天 | - | 1天 |
| Phase 3 | 3-4天 | P1完成后可并行 | 1天 |
| Phase 4 | 5-6天 | - | 2天 |
| Phase 5 | 4-5天 | P4可部分并行 | 1天 |
| Phase 6 | 4-5天 | P5可部分并行 | 1天 |
| Phase 7 | 3-4天 | 依赖全部完成 | 1天 |
| Phase 8 | 2-3天 | - | 1天 |
| **总计** | **~30-40天** | - | **~9天** |

---

## ⚠️ 风险评估与缓解

### 高风险点

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|----------|
| 编译错误级联 | 高 | 中 | 增量迁移，每阶段验证 |
| 运行时性能退化 | 中 | 低 | 基准测试，性能回归检测 |
| 数据迁移失败 | 高 | 低 | 保持DB兼容，双写验证 |
| 功能遗漏 | 高 | 中 | 完整测试覆盖，功能清单 |
| 团队成员冲突 | 中 | 高 | 分支策略，代码冻结期 |

### 回滚策略

每个 Phase 结束时创建 Git Tag：

```bash
# Phase 1 完成
git tag mcp-refactor-p1-complete
git push origin mcp-refactor-p1-complete

# 如需要回滚
git checkout -b rollback-p1 mcp-refactor-p1-complete
```

---

## 🧪 测试策略

### 各阶段测试矩阵

| 阶段 | 单元测试 | 集成测试 | E2E测试 | 性能测试 |
|------|----------|----------|---------|----------|
| P0 | - | - | 基线 | 基线 |
| P1 | ✅ | - | - | - |
| P2 | ✅ | ✅ | - | - |
| P3 | ✅ | ✅ | - | - |
| P4 | ✅ | ✅ | - | ✅ |
| P5 | ✅ | ✅ | - | - |
| P6 | ✅ | ✅ | - | - |
| P7 | ✅ | ✅ | ✅ | ✅ |
| P8 | ✅ | ✅ | ✅ | ✅ |

### 关键测试用例

```rust
// tests/integration/mcp_refactor_tests.rs

#[test]
fn test_backward_compatibility() {
    // 验证新旧数据结构兼容
}

#[test]
fn test_feature_parity() {
    // 验证功能完整无缺漏
}

#[test]
fn test_performance_regression() {
    // 性能不下降超过 5%
}
```

---

## 📚 文档更新清单

- [ ] `docs/architecture/mcp.md` - 架构图更新
- [ ] `docs/development/mcp-guide.md` - 开发指南
- [ ] 各 crate 的 README.md
- [ ] API 文档 (`cargo doc`)
- [ ] CHANGELOG.md

---

## 🔧 迁移工具脚本

详见 `scripts/mcp-migration/` 目录：

| 脚本 | 用途 |
|------|------|
| `setup-crates.sh` | 初始化 crates 目录 |
| `migrate-types.sh` | 类型迁移 |
| `migrate-store.sh` | 存储层迁移 |
| `verify-migration.sh` | 迁移验证 |
| `rollback.sh` | 回滚工具 |

---

## ✅ 验收标准

1. **编译通过**: `cargo build --release` 无错误
2. **测试通过**: `cargo test` 通过率 100%
3. **功能完整**: 所有原有功能正常工作
4. **性能达标**: 不低于迁移前 95%
5. **文档完整**: 架构文档、API文档、开发指南齐全
6. **代码质量**: `clippy` 无警告，`fmt` 通过

---

**计划制定**: 2025年  
**最后更新**: 见 Git 历史  
**负责人**: 待分配  
**审批状态**: 待审批

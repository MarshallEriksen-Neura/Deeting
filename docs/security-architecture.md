# Deeting 安全策略架构（Security Architecture）

> 适用范围：桌面端工具调用的风险评估、审批闸门、会话级授权、沙箱执行边界、敏感路径与网络的硬约束。
> 不覆盖：DAG / Approval Gate 节点的状态机（见 [agent-dag-architecture.md](./agent-dag-architecture.md)）；记忆系统的写入闸门（见 [memory-architecture.md](./memory-architecture.md)）。

本文档面向想读懂 Deeting 在桌面端"工具会做坏事吗 / 什么时候要问用户 / 什么时候直接拒"的整套机制。三个角色合作：

- **Risk Assessment**：每次工具调用前评估一份 `ToolRiskAssessment`。
- **Approval Gate**：风险高的进 DAG 上的 ApprovalGate 节点，等用户决定。
- **Sandbox Runtime**：高风险代码执行被限制在 BoxLite 沙箱（host / native / WSL 三后端）。

## 1. TL;DR

Deeting 桌面端做的事可能很**有破坏性**——可以执行 shell 命令、打开浏览器、写文件、访问网络。安全策略要回答两个问题：

1. **这次调用要不要拦下来问用户？**（Risk Assessment + Approval Gate）
2. **拦不住的话，能不能在沙箱里跑而不是直接在主机上跑？**（Sandbox Runtime）

回答这两个问题的核心模型是**三维度风险分类**：

```
ToolRiskAssessment {
    operation_class: NetworkRead | FilesystemRead | FilesystemWrite | ProcessExec | Unknown,
    target_class:    PublicInternet | PrivateNetwork | Localhost | SensitivePath | Host | Unknown,
    boundary_class:  None | SoftBoundary | HardBoundary,
}
```

外加 `risk_level` 标签（LOW / MEDIUM / HIGH / CRITICAL）和 `reasons` 文本数组（给 UI 解释为什么）。

工程纪律：
- **boundary_class 才是真正的开关**——`HardBoundary` 永远需要每次审批（不能 grant），`SoftBoundary` 可以走会话级 grant，`None` 直接放行。
- **operation_class × target_class 决定是否 grant_eligible**——只有"软边界 + 非 ProcessExec + 公网或未知目标"的组合可以被授权"这次会话内不再问"。
- **风险评估器是纯函数**——给同样的 (tool_name, arguments) 永远输出同样的 assessment；这是审计、replay、PR review 的前提。

核心代码：

```
deeting/src-tauri/src/modules/
├── mcp/
│   ├── risk.rs                     // ToolRiskAssessment + 三种 assess_* 函数 + URL/路径分类器
│   ├── commands/
│   │   └── runtime/
│   │       └── tool_execution.rs   // 实际执行入口：先 assess，再决定 approval / direct
│   └── store/...                   // 持久化 grant key / approval 记录
├── desktop_runtime/runtime/
│   ├── chat_tool_runtime/
│   │   ├── mod.rs                  // agentic loop 里 hook risk assessment
│   │   ├── approval_commands.rs    // Tauri approve / reject 命令
│   │   └── inflight.rs             // PersistedPendingApproval 包含 risk_level / risk_reasons
│   └── capability_control_plane.rs // 能力门禁（哪些工具能被发现）
├── capability_control_plane/
│   └── store.rs                    // capability 授权 / 撤销持久化
└── sandbox/
    ├── mod.rs / manager.rs         // 沙箱总入口（多后端切换）
    ├── backend_host.rs             // Host Python（主机内进程）
    ├── backend_native.rs           // Native（同进程内嵌）
    ├── backend_wsl.rs              // Windows WSL 后端（Windows 独占）
    ├── installer.rs                // BoxLite 安装器（首次 setup）
    ├── boxlite_sidecar_client.rs   // 与 BoxLite sidecar 的本地 HTTP/WS 通信
    └── provisioner.rs              // 后端选择 / 准备
```

## 2. 为什么这么做

朴素安全模型的几个坑：

1. **"反正会问用户"陷阱**。每个工具都问一遍 = 用户审批疲劳 → 用户开始无脑点 Approve → 等同于没保护。
2. **"白名单"陷阱**。维护一份白名单工具就放行——但工具 `arguments` 千变万化，同一个 `browser_open_tab` 工具，目标是 `https://example.com` 和 `http://127.0.0.1:8080/admin` 风险天差地别。
3. **"风险分数化"陷阱**。把所有维度叠加成一个 0-100 分数 → PR review 时没人能解释"为什么这次 87 分被拦"。
4. **"自动学审批"陷阱**。让模型自己学"用户一般会同意什么"——这给了攻击者一个学得动的接口，prompt injection 可以"教会"模型自动批准危险操作。

Deeting 的选择：

| 朴素安全模型的坑 | Deeting 的做法 |
|---|---|
| 一刀切审批 | 三维度分类：operation × target × boundary，**有正交语义** |
| 把所有维度叠成一个分 | 每个维度都保留独立 enum 值；分数（risk_level）只是 UI 标签，决策走 boundary_class |
| 工具白名单 | 工具 + arguments 联合评估；同一工具不同 url 产出不同 assessment |
| 自动学审批 | grant 只能由用户**显式行为**创建；不学、不预测、不补全 |
| 沙箱可选 | 高危执行**必须**进沙箱，沙箱不可用 = 操作不可用 |
| 单端审批 | Approval 走 DAG 上的 `ApprovalGate` 节点，跨进程持久化 |

## 3. 三维度风险模型

[`mcp/risk.rs`](../deeting/src-tauri/src/modules/mcp/risk.rs)。

### 3.1 `RiskOperationClass`（操作类别）

```rust
pub enum RiskOperationClass {
    Unknown,            // 不能分类（通常 LOW）
    NetworkRead,        // 网络读（HTTP GET / 浏览器导航 / 远程 MCP）
    FilesystemRead,     // 文件系统读
    FilesystemWrite,    // 文件系统写
    ProcessExec,        // 进程执行（shell / 浏览器自动化 / 高危脚本）
}
```

`ProcessExec` 是**最严的级别**——它和 `Host` target 组合一定会被分类为 `HardBoundary`，永远不能走会话级 grant。

### 3.2 `RiskTargetClass`（目标类别）

```rust
pub enum RiskTargetClass {
    Unknown,
    Host,               // 主机本身（执行 / 写 / 读 sensitive）
    PublicInternet,     // 公网（example.com）
    PrivateNetwork,     // 私网（10.x / 192.168.x / .local / .internal）
    Localhost,          // 本机回环（127.0.0.1 / localhost）
    SensitivePath,      // /etc /root /home /usr /bin /sbin /boot
}
```

**`Localhost` 和 `PrivateNetwork` 在 Deeting 这里被刻意视为高敏**——因为：

- `127.0.0.1:8080/admin` 通常是用户自己跑的后台/管理面板
- `192.168.x` 是用户的家庭/办公网络
- 这两类目标允许"模型自动操作"等价于把内网管理权交给 AI

> 这是反 SSRF 风险面的关键。许多通用 agent 框架默认把 localhost 当成"安全"，Deeting 把它**显式当成 HardBoundary**。

### 3.3 `ApprovalBoundaryClass`（审批边界）

```rust
pub enum ApprovalBoundaryClass {
    None,              // 不需要审批
    SoftBoundary,      // 需要审批，但可被会话级 grant 豁免
    HardBoundary,      // 需要审批，每次都问，永不豁免
}
```

**`HardBoundary` 是工程纪律的核心**：
- 任何 `ProcessExec`
- 任何写 `SensitivePath`
- 任何访问 `Localhost` / `PrivateNetwork`
- 任何 shell-like / destructive 关键字

都会被强制升到 `HardBoundary`。这条线**业务代码不能绕过**。

### 3.4 三维度的组合实例

| 工具 + 上下文 | operation_class | target_class | boundary_class | risk_level |
|---|---|---|---|---|
| `browser_agent_status` | Unknown | Unknown | None | LOW |
| `browser_get_active_page` | NetworkRead | Unknown | None | LOW |
| `browser_open_tab` (https://example.com) | NetworkRead | PublicInternet | SoftBoundary | MEDIUM |
| `browser_open_tab` (http://127.0.0.1:8080) | NetworkRead | Localhost | HardBoundary | HIGH |
| `browser_click` | ProcessExec | Host | HardBoundary | HIGH |
| `browser_storage_write` | ProcessExec | Host | HardBoundary | HIGH |
| `shell_execute` | ProcessExec | Host | HardBoundary | HIGH |
| MCP tool with `bash` runtime, args contain `rm -rf` | ProcessExec | Host | HardBoundary | CRITICAL |
| MCP tool with `https://example.com` only | NetworkRead | PublicInternet | SoftBoundary | MEDIUM |
| Skill binding python + sensitive path read | FilesystemRead | SensitivePath | HardBoundary | HIGH |

## 4. 三个风险评估器

[`mcp/risk.rs`](../deeting/src-tauri/src/modules/mcp/risk.rs) 提供三个评估入口，对应三类工具来源：

### 4.1 `assess_core_tool_risk(tool_name, arguments)`

适用：Deeting 自带的核心工具（browser_* / shell_execute / ...）。

特征：**逐工具硬编码 match 分支**。原因：核心工具集合稳定、语义明确，逐个分类是最可读、最安全的做法。**不会**用启发式打分。

例（节选）：

```rust
"shell_execute" => ToolRiskAssessment {
    requires_approval: true,
    risk_level: "HIGH",
    reasons: vec!["shell execution can mutate host state".to_string()],
    operation_class: RiskOperationClass::ProcessExec,
    target_class: RiskTargetClass::Host,
    boundary_class: ApprovalBoundaryClass::HardBoundary,
},
"browser_open_tab" => match classify_url_target(url) {
    Some(Localhost)        => HardBoundary HIGH,
    Some(PrivateNetwork)   => HardBoundary HIGH,
    Some(PublicInternet)   => SoftBoundary MEDIUM,
    _                      => SoftBoundary MEDIUM,
},
```

工程纪律：
- 加新核心工具 = 新 match 分支 = 显式分类。
- **不要**在外面包一层"自动补默认值"——分类不全的工具应该报警。

### 4.2 `assess_mcp_tool_risk(tool, arguments)`

适用：第三方 MCP 工具。

特征：**启发式 + 加权打分**。原因：MCP 工具是开放的，无法逐个枚举；通过 metadata（`source_type` / `command` / `args` / `capabilities`）+ 危险关键字检测打分。

打分维度（每命中 +1 ~ +3）：

| 检测 | 分值 |
|---|---|
| 远程 SSE MCP | +1，operation=NetworkRead，boundary=Soft |
| 本地 process lifecycle 工具 | +3，operation=ProcessExec，target=Host，boundary=Hard |
| 非 Local source_type | +2 |
| 危险关键字（command / args / arguments）：`powershell`, `bash`, `rm`, `del`, `format`, `shutdown`, ... | +3，operation=ProcessExec，boundary=Hard |
| 高危名称（含 `delete`, `write`, `shell`, `execute`, `terminal` 等） | 与上面合并 |
| `capabilities` 含 `shell`/`terminal`/`write`/`network`/`filesystem` | +1，按具体能力升级 boundary |
| `arguments.path` 命中 `/etc /root /home /usr /bin /sbin /boot` | +2，target=SensitivePath，boundary=Hard |
| `arguments.url` localhost / private network | +1，boundary=Hard |
| `arguments.url` 走 `http://`（明文） | +1，boundary 提升到至少 Soft |

最终 risk_level：score ≥ 3 → HIGH，≥ 2 → MEDIUM，否则 LOW。

### 4.3 `assess_skill_binding_risk(binding, arguments)`

适用：本地 skill（`skills/` 目录里的 bash / python / node 脚本）。

特征：和 MCP 类似但**起步分更高**（skill binding 默认走本地 runtime）：

```rust
score += 1;
reasons.push("skill binding executes local runtime");
```

外加运行时识别：
- `bash` → +3, ProcessExec, Host, Hard
- `python` → +2
- `node` → +2
- 其他 → +1

`critical_keywords` 列表（任一命中 +3 升到 HardBoundary）：

```
"rm -rf", "rm -fr", "del /", "format ", "dd if=", "mkfs", "fdisk",
"> /dev/", "curl | bash", "curl | sh", "wget |",
"eval (", "exec (", "/bin/sh -c", "/bin/bash -c"
```

`warning_keywords`（+2 升到 HardBoundary）：

```
"powershell", "pwsh", "cmd.exe", "wscript", "cscript", "rundll32",
"mshta", "shutdown", "reboot", "sudo ", "chmod 777", "chown ",
">/etc/", ">/root/", ">/home/"
```

skill binding 用更严的 4 档阈值：`(critical=6, high=4, medium=2)`——任意一个 critical_keyword 命中就直接 CRITICAL。

### 4.4 共享分类器

[`classify_url_target(url)`](../deeting/src-tauri/src/modules/mcp/risk.rs)：

```text
URL → host
host == "localhost" 或 ends_with(".localhost") → Localhost
host 是 IPv4/IPv6:
    loopback                                   → Localhost
    private (RFC1918) / link-local / unspecified → PrivateNetwork
    其他                                       → PublicInternet
host 是域名:
    ends_with .local / .internal / .lan / .home → PrivateNetwork
    其他                                       → PublicInternet
```

[`is_sensitive_path(path)`](../deeting/src-tauri/src/modules/mcp/risk.rs)：

```text
sensitive_paths = ["/etc", "/root", "/home", "/usr", "/bin", "/sbin", "/boot"]
任一前缀匹配 → true
```

> 注意：这两个分类器今天偏 Unix-friendly。Windows 上 `C:\Windows`、`C:\Users\<u>\AppData` 等路径**没有**进 sensitive 列表——未来扩展时应该按平台补全（见 §10.2）。

## 5. Approval Grant（会话级授权）

### 5.1 grant_eligible 条件

[`ToolRiskAssessment::grant_eligible`](../deeting/src-tauri/src/modules/mcp/risk.rs)：

```rust
pub fn grant_eligible(&self) -> bool {
    self.boundary_class == ApprovalBoundaryClass::SoftBoundary
        && !matches!(self.operation_class, RiskOperationClass::ProcessExec)
        && matches!(
            self.target_class,
            RiskTargetClass::PublicInternet | RiskTargetClass::Unknown
        )
}
```

可以被 grant 的**仅有**：
- `SoftBoundary`
- 不是 `ProcessExec`
- 目标是 `PublicInternet` 或 `Unknown`

这意味着：
- 浏览器在公网爬数据可以 grant 一次后这一次会话不再问
- 但任何"打开 localhost 管理界面"永远每次都问
- 任何 shell 执行永远每次都问

### 5.2 Grant Key 结构

```rust
pub fn policy_rule_key(&self, tool_fingerprint: &str) -> Option<String> {
    Some(format!(
        "{}|{}|{}|{}",
        tool_fingerprint,
        operation_class.as_str(),
        target_class.as_str(),
        boundary_class.as_str(),
    ))
}
```

例：`fingerprint-1|network_read|public_internet|soft_boundary`

Key 是 grant 的**主键**——同一组 (fingerprint, op, target, boundary) 的同会话再次调用直接放行。改了 url 到 localhost? key 中 target_class 变了 → 不命中 → 重新问。

### 5.3 `SessionApprovalGrant`

```rust
pub struct SessionApprovalGrant {
    pub key: String,
    pub tool_fingerprint: String,
    pub operation_class: RiskOperationClass,
    pub target_class: RiskTargetClass,
    pub boundary_class: ApprovalBoundaryClass,
    pub created_at_unix_ms: i128,
}
```

`SessionApprovalGrant::from_key(key, now)` 反向解析——存储层只持久化 key 字符串，运行时按需 parse 出维度。

### 5.4 历史兼容（`approval_classes_from_key`）

[`approval_classes_from_key`](../deeting/src-tauri/src/modules/mcp/risk.rs) 解析 key 时**只读尾部 3 段**——历史 key 曾经把 tool fingerprint 拆得更细（多个 `|` 段），现在只关心 `operation|target|boundary` 三段在尾部。测试 `approval_classes_from_key_ignores_legacy_prefix_segments` 守护这条不变式。

## 6. 与 DAG / Approval Gate 的协同

完整审批生命周期在 [agent-dag-architecture.md §9](./agent-dag-architecture.md#9-approval-gate-完整生命周期) 已经详述。这里只看安全相关的接口点：

```text
chat_tool_runtime 调用 tool
        ↓
mcp/commands/runtime/tool_execution.rs
        ↓
1. 根据来源选择评估器：
     core tool         → assess_core_tool_risk
     MCP tool          → assess_mcp_tool_risk
     skill binding     → assess_skill_binding_risk
2. 拿到 ToolRiskAssessment
3. 查 grant store: 同 key 已有未过期 grant?
     是 → 直接放行（boundary != HardBoundary）
4. boundary_class:
     None              → 直接执行
     SoftBoundary      → emit approval gate, 等用户
     HardBoundary      → emit approval gate, 等用户（且不创建 grant）
5. 用户审批后:
     SoftBoundary + grant_eligible → 写 SessionApprovalGrant
     HardBoundary                  → 不写 grant
6. PersistedPendingApproval 携带:
     - risk_level / risk_reasons
     - policy_rule_key
     - approval_grant_key（如可 grant）
     - tool_fingerprint
     → 给前端展示 + 持久化到 DAG
```

`PersistedPendingApproval` 完整结构见 [agent-dag-architecture.md §9.1](./agent-dag-architecture.md#91-persistedpendingapproval-的全字段)。

## 7. Sandbox Runtime（沙箱执行）

[`modules/sandbox/`](../deeting/src-tauri/src/modules/sandbox/) 是高危执行的隔离层。

### 7.1 三种后端

```rust
pub enum SandboxRuntimeMode {
    Host,    // backend_host.rs — 主机内子进程（Python）
    Native,  // backend_native.rs — 同进程内嵌（轻量，受限）
    Wsl,     // backend_wsl.rs — Windows WSL Linux 子系统（Windows 独占）
}
```

[`SandboxRuntimeManager`](../deeting/src-tauri/src/modules/sandbox/manager.rs) 是统一入口，自动按平台选择最佳后端：

- **Windows**：优先 `Wsl`（真正的 Linux 隔离），fallback 到 `Host`。
- **macOS / Linux**：默认 `Host`（用主机 Python 进程；后续可加 `Native`）。

切换通过 `Arc<RwLock<Arc<dyn SandboxProvider>>>` 热更新——支持运行时降级。

### 7.2 BoxLite Sidecar

实际隔离环境是 **BoxLite**——一个独立打包的 sidecar 进程，通过本地 HTTP/WebSocket bridge 通信。

- [`installer.rs`](../deeting/src-tauri/src/modules/sandbox/installer.rs)：首次启动自动安装 BoxLite（WSL 上）。
- [`boxlite_sidecar_client.rs`](../deeting/src-tauri/src/modules/sandbox/boxlite_sidecar_client.rs)：与 BoxLite 的本地通信客户端。
- 默认 bridge 发现 URL：`http://127.0.0.1:9090`（[`DEFAULT_BRIDGE_DISCOVERY_URLS`](../deeting/src-tauri/src/modules/sandbox/manager.rs)）。

### 7.3 安全属性

沙箱提供的边界：

- **文件系统**：受限挂载点，不直接看主机 `/`
- **网络**：可受策略限制
- **进程**：执行受限于沙箱命名空间
- **持久化**：沙箱内的写入不会自动同步回主机（需要显式 `save_asset` 这类工具，目前**实验性禁用**——见 risk.rs 注释）

### 7.4 状态报告

[`SandboxReadinessReport`](../deeting/src-tauri/src/modules/sandbox/manager.rs) 给前端展示沙箱当前可用性：

```text
{
  "runtime_mode": "wsl" | "host" | "native",
  "wsl": { ... WSL 诊断 },
  "boxlite": { ... 安装状态 },
  "readiness": "ready" | "needs_setup" | "unavailable"
}
```

UI 上的"环境检测"卡片就读这个报告。

### 7.5 不可用降级

如果沙箱不可用（用户没装 WSL / BoxLite 未安装 / 进程死了）：

- 默认行为是**该操作被禁用**，UI 提示用户去 setup 页修复。
- **不会**自动退化到"直接在主机上跑"——那会让"沙箱"这层防御无声失效。
- 这条纪律由 sandbox manager 的 `is_available` 检查 + 上层 capability_control_plane 的 gate 共同保证。

## 8. Capability Control Plane（能力门禁）

[`capability_control_plane.rs`](../deeting/src-tauri/src/modules/capability_control_plane.rs) + [`capability_control_plane/store.rs`](../deeting/src-tauri/src/modules/capability_control_plane/store.rs) 是工具**发现层**的门禁——不是审批，是**可见性**：

```text
OfficialSkillHostToolRoute {
    DesktopCapability,   // 内建能力（如 deeting-* 工具）
    SearchSdk,           // search_sdk 工具
    GetToolSchema,       // 元工具
    Unsupported,         // 不支持 → 不可见
}
```

`resolve_official_skill_host_tool_route(tool_name)` 决定一个工具名是否被 runtime 接受。**未注册的工具名**（不是 capability、不是 SDK 元工具、不是 search）会被直接拒绝调用——这是一道在 risk assessment 之前的早期门。

此外，[`current_user_can_access_restricted_asset`](../deeting/src-tauri/src/modules/capability_control_plane.rs) 实现按用户角色对**受限资产**的访问门禁——某些 desktop capability 只对特定 user role 开放（admin / developer / 默认用户）。

## 9. 防御纵深（Defense in Depth）

把上面所有层叠起来，一次"模型决定调用 shell_execute 删除 /etc/passwd"的请求会被这样拦：

```text
1. Capability Control Plane 检查
   - shell_execute 是注册的核心 capability ✓ 通过
   - 用户权限 ✓ 通过

2. Risk Assessment (assess_core_tool_risk)
   - tool_name = shell_execute → HardBoundary, HIGH, ProcessExec, Host

3. Grant Store 检查
   - HardBoundary 永远不命中 grant → 必须问

4. DAG: 创建 ApprovalGate 节点
   - PersistedPendingApproval 写到 SQLite
   - inflight.stage = WaitingApproval
   - 主 loop 返回，UI 弹审批卡

5. 用户看到审批卡
   - tool: shell_execute
   - risk_level: HIGH
   - reasons: ["shell execution can mutate host state"]
   - 用户点 Reject

6. graph.approval_gate.status = Rejected
   - 工具不执行，不创建 grant
   - 进入下一轮 LLM，给模型一个 tool_result 说"用户拒绝"

7. 即使用户被 prompt injection 骗着点 Approve:
   - HardBoundary 不创建 grant → 下一次同样的 shell_execute 还会再问
   - 命令本身（如果 deeting 是配置成沙箱路径）会进 sandbox runtime
   - sandbox 内的 /etc 不是主机的 /etc → 实际上不会破坏主机

每一层都是独立的、可测试的、可拒绝的。任何一层失效都不等于整个安全失守。
```

## 10. 文件地图

按"我想改什么"反向定位：

| 我想… | 看这里 |
|---|---|
| 改某个核心工具的风险等级 | [`mcp/risk.rs::assess_core_tool_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) 对应 match 分支 |
| 改 MCP 工具的启发式打分 | [`mcp/risk.rs::assess_mcp_tool_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| 改 skill binding 的关键字列表 | [`mcp/risk.rs::assess_skill_binding_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) (`critical_keywords` / `warning_keywords`) |
| 改 URL 分类 | [`mcp/risk.rs::classify_url_target`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| 改敏感路径列表 | [`mcp/risk.rs::is_sensitive_path`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| 改 grant_eligible 规则 | [`mcp/risk.rs::ToolRiskAssessment::grant_eligible`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| 改 grant key 编码格式 | [`mcp/risk.rs::policy_rule_key`](../deeting/src-tauri/src/modules/mcp/risk.rs) + 同步 `approval_classes_from_key` + `SessionApprovalGrant::from_key` + 测试 |
| 加新沙箱后端 | [`sandbox/manager.rs::SandboxRuntimeManager::build_provider`](../deeting/src-tauri/src/modules/sandbox/manager.rs) + 新 backend_*.rs |
| 改沙箱默认 bridge URL | [`sandbox/manager.rs::DEFAULT_BRIDGE_DISCOVERY_URLS`](../deeting/src-tauri/src/modules/sandbox/manager.rs) |
| 改 capability 门禁路由 | [`capability_control_plane.rs::resolve_official_skill_host_tool_route`](../deeting/src-tauri/src/modules/capability_control_plane.rs) |
| 改 approval 命令处理 | [`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs) |
| 改 approval 持久化字段 | [`chat_tool_runtime/inflight.rs::PersistedPendingApproval`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) |

## 11. 怎么扩展

### 11.1 加一个核心工具的风险分类（例：`fs_write_file`）

1. 在 [`assess_core_tool_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) 加 match 分支：
   ```rust
   "fs_write_file" => {
       let path = arguments.get("path").and_then(Value::as_str).unwrap_or_default();
       if is_sensitive_path(path) {
           ToolRiskAssessment {
               requires_approval: true,
               risk_level: "HIGH",
               reasons: vec!["writing to a sensitive path".to_string()],
               operation_class: RiskOperationClass::FilesystemWrite,
               target_class: RiskTargetClass::SensitivePath,
               boundary_class: ApprovalBoundaryClass::HardBoundary,
           }
       } else {
           ToolRiskAssessment {
               requires_approval: true,
               risk_level: "MEDIUM",
               reasons: vec!["filesystem write".to_string()],
               operation_class: RiskOperationClass::FilesystemWrite,
               target_class: RiskTargetClass::Host,
               boundary_class: ApprovalBoundaryClass::HardBoundary,
           }
       }
   }
   ```

2. 写测试：构造 (sensitive_path, normal_path) 两个用例，断言 boundary_class、risk_level、operation_class、target_class 都符合预期。

3. **不要**忘了：这是 ProcessExec/FilesystemWrite，所以默认就是 HardBoundary——除非你能解释为什么这次允许 grant，否则不要做 grant_eligible。

### 11.2 加 Windows-friendly 的敏感路径

1. 修改 [`is_sensitive_path`](../deeting/src-tauri/src/modules/mcp/risk.rs)：
   ```rust
   fn is_sensitive_path(path: &str) -> bool {
       let normalized = path.to_lowercase();
       let unix_sensitive = ["/etc", "/root", "/home", "/usr", "/bin", "/sbin", "/boot"];
       let windows_sensitive = [
           r"c:\windows",
           r"c:\program files",
           r"c:\users\",         // 注意 trailing 斜杠
           r"c:\programdata",
       ];
       unix_sensitive.iter().any(|p| path.starts_with(p))
           || windows_sensitive.iter().any(|p| normalized.starts_with(p))
   }
   ```

2. 写跨平台测试：
   - Linux: `/etc/passwd` ✓
   - Windows: `C:\Windows\System32\config\SAM` ✓
   - Windows: `C:\Users\Alice\Documents\note.md` ✗（用户自己的文档不算敏感）

3. 考虑：是否要把 `C:\Users\<u>\.ssh` 也加进去？通常需要——按平台单独写一个 detection 函数。

### 11.3 加新的沙箱后端（例：Docker on macOS）

1. 新建 `backend_docker.rs`，实现 [`SandboxProvider`](../deeting/src-tauri/src/modules/sandbox/provider.rs) trait。
2. 在 [`manager.rs::build_provider`](../deeting/src-tauri/src/modules/sandbox/manager.rs) 加分支：检测 Docker 可用 → 优先使用。
3. 加诊断函数：`diagnose_docker_availability()`（参考 `diagnose_wsl_availability`）。
4. 接到 `SandboxReadinessReport`，让 UI 能显示 Docker 状态。
5. **不要**在沙箱不可用时悄悄回退到 Host 后端——必须显式让用户知道。

## 12. 反模式（PR review 时拒绝）

- 在风险评估器之外的地方判定 `requires_approval`（绕过 risk.rs）
- 给 `HardBoundary` 加例外（除非用户**显式**配置）
- 让 `ProcessExec` 变成 grant_eligible
- 写"如果同会话已 approve 过任何 tool 就跳过审批"的全局豁免
- 让模型自己决定"这次需不需要审批"（self-approving agent = 安全漏洞）
- 改 `approval_classes_from_key` 但不维护历史 key 兼容（用户的旧 grant 会全部失效）
- 把 grant key 里的 fingerprint 改成 tool_name（fingerprint = tool + args 摘要；tool_name 不足以唯一）
- 修改 `is_sensitive_path` 但只测了 Unix（Windows 路径不能漏）
- 在沙箱不可用时静默回退到主机执行
- 把 BoxLite 安装路径硬编码（必须可配置 + 自动发现）
- Approval 卡片不展示 `risk_reasons`（用户不知道在批准什么）
- 写日志时把 `arguments` 完整打印（可能含敏感数据）

## 13. 已知决策与权衡

| 决策 | 为什么 |
|---|---|
| 三维度 enum 而非数字风险分 | enum 可 PR review、可测试、可解释；数字分会让"为什么这次 87 分"变成玄学 |
| `risk_level` 字符串只给 UI 用 | 决策走 `boundary_class`；UI 标签不可作为安全门 |
| `Localhost` / `PrivateNetwork` 默认 HardBoundary | 反 SSRF；用户内网设备的访问权不能给 AI 自由 |
| `ProcessExec` 永远 HardBoundary | shell / 浏览器自动化 / scripted host mutation 都是不可逆的 |
| Grant 只对 SoftBoundary + 非 ProcessExec + 公网 | 让"反复爬一个站点"不再问，但永远问"内网"和"执行" |
| 评估器是纯函数 | 同样输入永远同样输出 → 可 replay、可 PR review、可测试 |
| 三种评估器分别针对 core / MCP / skill | 每类工具的可信度本质不同，混用算法会让某类偏松或偏紧 |
| 沙箱不可用 = 操作不可用（不静默回退） | 静默回退 = 沙箱失效；明确报错 = 用户能去修 |
| Approval 进 DAG 的 ApprovalGate 节点 | 跨进程持久、可恢复；不要做独立的 approval 缓存 |
| `approval_classes_from_key` 只读尾部 3 段 | 兼容历史 key 演进；变更需要带迁移 + 兼容测试 |

## 14. 验证清单

改动安全策略的 PR 必须自检：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib mcp::risk --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `cargo test --lib sandbox --no-fail-fast`
- [ ] 关键不变式测试仍然绿：
  - `assess_skill_binding_risk_escalates_localhost_to_hard_boundary`
  - `assess_mcp_tool_risk_marks_remote_network_tool_as_soft_boundary`
  - `soft_boundary_public_network_reads_are_grant_eligible`
  - `localhost_requests_do_not_produce_session_grants`
  - `session_approval_grant_round_trips_from_key`
  - `approval_classes_from_key_ignores_legacy_prefix_segments`
- [ ] grant key 格式变更：写迁移 + 老 key 解析仍能产出可用 grant
- [ ] 桌面端手测：
  - `shell_execute` 始终弹审批，不论之前 approve 过多少次
  - `browser_open_tab https://example.com` approve 一次后会话内不再问
  - `browser_open_tab http://127.0.0.1:8080` 每次都问
  - 沙箱关闭（手动 kill BoxLite）后，相关工具不能调用（UI 显示原因）

> Windows 主机已知 caveat：`cargo test` 可能因 DLL 启动失败（STATUS_ENTRYPOINT_NOT_FOUND）失败——区分编译/运行失败，运行失败到 CI/Linux 复跑。

## 15. FAQ

**Q：为什么不直接用现成的 OS sandbox（macOS Seatbelt / Linux seccomp / Windows AppContainer）？**
A：(1) Deeting 是跨平台桌面应用，依赖任一平台特性都会让另两个平台变得不安全；(2) BoxLite 提供的 Linux 用户态沙箱在三个平台上语义一致——可观测、可调试、可在 PR 里 reason；(3) 长期可以叠加 OS 级别加固，但今天的 baseline 是统一的。

**Q：HardBoundary 永远不能 grant，那 shell_execute 在大量需要的场景里会不会让用户审批疲劳？**
A：会。这是刻意的取舍——shell_execute 是最危险的操作，用户必须每次有意识地按一次。如果某个用户体验真的需要"反复连续 shell"（如调试一组命令），正确做法是**让模型一次性提交所有命令**（一次审批多条），而不是降级安全性。这也是 `execute_code_plan` 走 worker plane 的设计初衷——一个大任务一次决策，而不是无数小决策。

**Q：grant_eligible 把 `Unknown` target 也算可 grant 是不是太松？**
A：刻意的。`Unknown` 通常意味着工具没声明清楚自己访问什么——这一类大多是"通用网络 fetcher"，目标是公网。要避免误判，工具实现者应该明确填 `target_class`。如果你设计的新工具是 `Unknown` 但实际访问 sensitive，应该在 risk 评估器里加分支显式分类。

**Q：BoxLite 安装失败时用户该怎么办？**
A：UI 在 dashboard / 设置页面会显示"环境检测"卡片，标红 sandbox 不可用 + 一个"重试安装"按钮。模型可用工具列表会**动态收缩**——任何依赖沙箱的工具暂时从 capability 里消失。用户修复后下次启动自动恢复。

**Q：如果 prompt injection 让模型生成"看起来无害"的 URL，但实际指向 localhost / 内网，安全模型抗得住吗？**
A：抗得住——因为 `classify_url_target` 是规则、纯函数，不会被 prompt 影响。`http://127.0.0.1:80/very_innocent_looking_page` 仍然被分类为 `Localhost` → `HardBoundary` → 弹审批卡 → 用户看到具体 URL 和 risk_reasons。

**Q：能不能让某个用户配置成"我自己批准过的所有 shell 命令都自动允许"？**
A：**不能**通过修改 boundary 实现——HardBoundary 是工程纪律。但可以通过另一条路径：把模型用 `execute_code_plan` 替代直接调 `shell_execute`，把多个命令打包成一个 worker 委托——单次审批授权一整个 plan，比逐条审批友好得多。这是产品上的正确答案。

**Q：风险评估器返回 `Unknown` 操作或目标时会怎样？**
A：默认 risk_level = LOW，boundary = None。这是为了不打扰用户。如果你看到生产里大量"Unknown / Unknown"的工具调用，那是 risk 评估器需要补分支——而不是 fallback 策略需要变严。

**Q：沙箱里跑的代码能不能调回 Deeting 主机的工具（如 memory）？**
A：不能直接调。BoxLite 是隔离的；如果一定要"沙箱内调主机能力"，必须通过明确的 RPC 接口（如 sidecar 暴露的 API）并且**这条 RPC 也走 risk assessment**——不要给沙箱内进程一个"绕过审批的快速通道"。

## 16. 参考

- 风险评估：[`mcp/risk.rs`](../deeting/src-tauri/src/modules/mcp/risk.rs)
- 工具执行入口：[`mcp/commands/runtime/tool_execution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs)
- 审批命令：[`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs)
- 持久化字段：[`chat_tool_runtime/inflight.rs::PersistedPendingApproval`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs)
- 能力门禁：[`capability_control_plane.rs`](../deeting/src-tauri/src/modules/capability_control_plane.rs)
- 沙箱管理：[`sandbox/manager.rs`](../deeting/src-tauri/src/modules/sandbox/manager.rs)
- 兄弟文档：[`rag-architecture.md`](./rag-architecture.md)、[`self-evolution-architecture.md`](./self-evolution-architecture.md)、[`agent-dag-architecture.md`](./agent-dag-architecture.md)、[`memory-architecture.md`](./memory-architecture.md)

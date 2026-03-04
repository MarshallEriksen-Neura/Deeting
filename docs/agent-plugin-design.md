# AI Agent 插件化设计草案（基于 backend_old 对齐版）

> 版本：2026-01-05（草案）  
> 依据：`backend_old/docs/AGENT_PLUGIN_GUIDE.md` 与现有网关架构对照

## 1. 目标与原则
- 兼容 backend_old 的“VS Code 风格”插件体系（Plugin Manager + Plugin Context + AgentPlugin）。
- 最小侵入迁移：不破坏现有 provider_preset / 计费 / 路由主链路，可灰度开关、快速回滚。
- 上下文隔离：插件仅通过 `PluginContext` 访问资源；密钥/ORM 会话由宿主注入。
- 可观测：插件级日志、耗时、错误率；可熔断单个插件实例。

## 2. backend_old 关键组件对齐
- **Host / Kernel**：`app/plugins/core/manager.py`（加载/生命周期）、`context.py`（DB/Logger/Config 注入）、`interfaces.py`（AgentPlugin 基类）。
- **插件产物**：工具（Function Calling schema）、生命周期钩子 `on_activate`、`get_tools`、`handle_xxx`。
- **Agent Runtime**：`PluginAwareTaskRunner`（`app/workers/plugin_runtime.py`）实现 ReAct 循环、自动路由工具调用。
- **现有插件**：provider registry、qdrant vector store、hello_world demo 等（`backend_old/app/plugins/builtins/*`）。

## 3. 新网关融合思路
1) **内核复用**：将 `backend_old/app/plugins/core/*` 迁移为新 backend 的 `app/agent_plugins/core/*`（命名空间隔离），保持接口不变。  
2) **上下文适配**：在新网关注入的 `PluginContext` 中提供：  
   - logger（复用 `app/logging_config.py`）；  
   - config/secret 读取（仅暴露经脱敏/代理的键）；  
   - DB/Redis session（只读或受限写）。  
3) **工具暴露路径**：  
   - Agent 场景：继续通过 `PluginAwareTaskRunner` 聚合工具给 LLM。  
   - 网关请求链路：允许 preset_item 声明需要的插件工具，按 capability 将工具暴露为 function calling（可选）。  
4) **生命周期钩子与执行链**：在 upstream 调用前后插入插件钩子：  
   - before_request → 参数/Prompt 预处理（匹配旧插件 `handle_*` 可选扩展）；  
   - after_response → 结构化响应、补充 usage；  
   - on_error → 重试/降级策略。  
   执行顺序按 preset_item.plugins 列表；错误策略可选“中断/跳过/回退”。
5) **配置与注册表**：  
   - `provider_preset_item.plugins` 字段存放插件引用与配置（name/version/config/enable）。  
   - 插件注册表由 `PluginManager` 维护，支持“按名称加载内置类”与未来动态加载（暂不做包下载）。  
6) **安全与隔离**：  
   - 插件拿到的是净化后的 `GatewayRequestFields` + 元信息（request_id、preset_item_id）；  
   - 禁止直接 import 全局设置或密钥；必须经 `context.get_config()`（可做白名单）；  
   - DB 访问走受限 session（只读或限定表），默认不暴露写能力。

## 4. 迁移路线图（MVP）
1) **抽取/拷贝内核**：把 `backend_old/app/plugins/core/*` 迁到新 backend（命名空间 `app/agent_plugins/core`），补充最小适配层。  
2) **最小示例插件搬运**：迁移 `builtins/provider_registry_plugin.py` 与 `examples/hello_world.py` 作为验证。  
3) **Preset Schema 扩展**：为 `provider_preset_item` 增加 `plugins`（JSONB，默认空数组）；Pydantic DTO 同步。  
4) **执行管线插入点**：在网关 upstream 请求链路增加 `plugins_runner`：`before_request → upstream → after_response`，错误走 `on_error`。  
5) **开关与监控**：新增全局 env `PLUGINS_ENABLED` 与 per-item `plugins_enabled`；添加插件级 metrics/logging。  
6) **测试**：  
   - 单测：插件注册/激活/工具路由、before/after/on_error 分支。  
   - 集成：mock upstream + 示例插件，验证字段污染与幂等。  
   - 性能：插件开关前后延迟对比。

## 5. 后续迭代
- 动态加载：插件包按目录扫描/版本管理；支持热更新与降级。  
- 流式插件：SSE 分片级别的 before/after hook。  
- 多租户隔离：插件可见性/配额按 org/user 控制。  
- UI/管理：插件启停、配置编辑、指标看板。

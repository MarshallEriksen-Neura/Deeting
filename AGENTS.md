# Repository Guidelines
请使用中文回答
## Project Structure & Module Organization
- `main.py`: FastAPI entrypoint and `apiproxy` script target.
- `app/`: Core gateway logic (`routes.py`, `upstream.py`, `auth.py`, `model_cache.py`, `context_store.py`, `settings.py`, `logging_config.py`).
- `tests/`: Pytest suite (async and sync tests), mirror new features here.
- `scripts/`: Helper scripts (e.g. `scripts/list_models.py`).
- `docs/`: Design notes (model routing, session context) that should stay in sync with code changes.
- `docs/api`: API 文档目录；若任务涉及任何 API 请求/响应、鉴权或错误码的改动，需在任务结束后立即更新对应文档，避免前端继续依赖过时说明。

## Build, Run & Test Commands
- Create env & install: `python -m venv .venv && source .venv/bin/activate && pip install .`
- Local dev server: `apiproxy` or `uvicorn main:app --reload`.
- Docker 开发/本地试用栈（镜像）：`IMAGE_TAG=latest docker compose -f docker-compose.develop.yml --env-file .env up -d` / `docker compose -f docker-compose.develop.yml down`.
- Docker 生产部署栈（镜像）：`IMAGE_TAG=latest docker compose -f docker-compose-deploy.yml --env-file .env up -d`.
- Run tests: `pytest` (or `pytest tests/test_chat_greeting.py` for a single file).

## Coding Style & Naming Conventions
- Python 3.12, PEP 8, 4-space indentation, `snake_case` for functions/variables, `PascalCase` for classes.
- Prefer type hints and small, focused async endpoints in `app/routes.py`.
- Keep configuration in `app/settings.py`, dependency wiring in `app/deps.py`, logging in `app/logging_config.py`.
- When adding new routes, reuse existing patterns for auth, context, and upstream calls.

## FastAPI 开发最佳实践
- 路由“瘦身”：API 只做入参校验、鉴权/依赖注入、调用 Service，业务与数据访问封装在 Service/Repository；禁止在路由中直接操作 ORM/Session。
- DTO 一致性：所有请求/响应使用 Pydantic schema（放在 `app/schemas/*`），schema 变更需同步到文档与依赖类型。
- 依赖注入：数据库、当前用户、权限等通过 `Depends` 提供，避免在路由函数内手动构造；生命周期由 `app/core/database.get_db` 控制。
- 错误处理：业务异常在 Service 内抛出自定义/HTTPException，API 只需透传；统一日志字段（trace/user/endpoint）方便审计。
- 安全与鉴权：身份校验走 `app/deps/auth.py` 的依赖，避免在路由中重复解析 Token；敏感信息输出前在 Service 层脱敏。
- 可观察性：路由与 Service 打点使用 `app.core.logging`，必要时添加中间件记录耗时、状态码；禁止在业务代码中直接 `print`。
- 性能与资源：异步 IO 优先，避免在路由中阻塞调用；需要 CPU 密集任务用后台任务/队列处理。
- 变更同步：新增/调整字段或行为时，务必同步更新测试（`tests/`）、迁移（如涉及模型）、以及 `docs/api` 对应文档。


## 后端重构注意事项（Provider Preset / AI Gateway）
- 单一真源：所有上游配置必须来自 `provider_preset` / `provider_preset_item`，严禁在 handler/transport/billing 硬编码。
- 字段约定：item 表需支持 `template_engine`（simple_replace/jinja2）、占位符化 `upstream_path`、`tokenizer_config`、细化的 `pricing_config`（input/output per 1k + currency）与 `limit_config`（rpm/tpm/timeout/retry）。
- 鉴权配置：`auth_config` 只存密钥引用 ID（secret_ref_id 等）与位置/前缀信息，禁止存明文；DTO 输出需统一脱敏。
- 数据流分层：API 只做校验；Service 负责路由/计费/模板渲染；Client 发送上游请求；Repository 统一 DB 访问，不在业务层直接用 Session。
- ORM 约束：业务层/路由/Depends 不直接写 ORM/SQL；统一通过 Repository 接口访问 DB（权限/策略也用仓库），避免散落 session/query/text。
- 异步/同步会话：FastAPI 路径使用 Async SQLAlchemy；Celery 任务使用独立的同步 Engine/Session，复用模型但分离会话工厂。
- 变更流程：新增/调整字段必须同步 Pydantic/Schema、Alembic 迁移、Repository/Service 逻辑和测试；必要时更新相关文档。
- AI Agent 填充：先落 `provider_metadata`（含 schema hash），再经转换器写入两张表；发现 hash 变化需告警并回归关键用例。
- 路由唯一性：业务查找以 (capability, model) + is_active + weight/priority 选择；数据库唯一约束保持 (preset_id, capability, model, upstream_path) 防重复。
- 测试基线：为模板渲染、路由决策、响应转换、限流/重试写合成测试；提交前请让人类运行 `pytest`。

## 配置/变量引用规范（重要）
- **禁止凭空杜撰**环境变量名、配置键、API 字段名、路由、错误码；引用前必须能在仓库代码/文档中找到真实定义或使用点。
- 在回答“某变量从哪里来/怎么配”这类问题时，**必须给出可定位的依据**（至少 1 个文件路径定位点，必要时说明可用的 `rg` 关键字）。
- 如确需新增环境变量/配置项：必须同步更新对应的示例与使用处（例如 `.env.example`、`frontend/.env.example`、相关代码），避免出现多套命名导致的 401/配置漂移。
- 前端 API 基础地址优先使用 `NEXT_PUBLIC_API_BASE_URL`（如需兼容历史变量名，应明确标注为兼容逻辑而非新规范）。

## 前端 UI 框架使用规范
- 技术栈与目录
  - 前端工程位于 `frontend/`，使用 **Next.js(App Router) + Tailwind CSS + shadcn/ui 风格组件库**。
  - 通用 UI 组件统一放在 `frontend/components/ui`（导入路径为 `@/components/ui`，例如 `button.tsx`, `input.tsx`, `card.tsx`, `dialog.tsx`, `table.tsx` 等）。
  - 业务组件按功能域划分到 `frontend/components/dashboard`、`frontend/components/layout`、`frontend/components/forms` 等目录，避免在 page 中堆大量 JSX。

- 设计规范与文档
  - 在设计或改版任何前端页面之前，必须先阅读根目录的 `ui-prompt.md`，遵循极简 / 墨水风格等统一视觉规范。
  - 新增页面前，优先查阅 `docs/fronted/*.md` 中的对应文档（如 `missing-ui-pages-analysis.md`、页面设计方案等），按文档里的信息架构和交互建议进行实现。
  - **文档编写原则**：**只有在用户明确要求时才编写或更新文档**。AI Agent 不应主动创建新的设计文档、技术文档或总结文档，除非用户明确声明需要文档输出。
  - 如任务涉及 API 行为、鉴权或错误码的改动，需在任务结束后更新 `docs/api/*.md` 对应文档，避免前端继续依赖过时说明。

- 组件复用与 shadcn
  - **组件使用优先级**（从高到低）：
    1. **优先使用 shadcn/ui 官方组件**：通过 `bunx shadcn@latest add <component>` 安装到 `@/components/ui`，例如 `button`, `card`, `dialog`, `input`, `select`, `table` 等。
    2. **复用已封装的业务组件**：使用 `@/components/dashboard`、`@/components/layout`、`@/components/forms` 等目录下已有的业务组件。
    3. **最后才考虑自定义封装**：只有在 shadcn/ui 没有提供对应组件，且现有业务组件无法满足需求时，才在 `@/components/ui` 中封装新的通用组件。
  - 新增或修改前端页面时，**禁止直接使用原生 HTML 标签**（如 `<button>`, `<input>`, `<select>`）堆叠 Tailwind class，必须使用 `@/components/ui` 中的组件。
  - 使用 Card 组件时，优先使用 `@/components/ui/card` 中的 `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` 等组件，保持卡片样式统一。
  - AI Agent 可以通过 **shadcn MCP** 查询/检索组件用法和示例代码。

- 路由结构与组件拆分
  - `frontend/app/**/page.tsx` 默认应为 **服务端组件**（不加 `"use client"`），负责页面布局和数据装载；有复杂交互或状态管理时，将交互逻辑拆到 `components/*-client.tsx` 等客户端组件中。
  - 客户端组件必须显式声明 `"use client"`，并放在 `frontend/components/**` 或 `frontend/app/**/components/**` 下，避免把所有逻辑堆在 page 文件里。
  - 复用 `@/components/layout/*` 等现有导航和布局组件，统一仪表盘、系统管理区的布局结构。

- API 请求与 SWR 封装
  - 前端访问后端时，应优先使用已封装好的 SWR 层：`@/lib/swr`（如 `useApiGet`, `useApiPost`, `useResource`, `useCreditBalance`, `useCreditTransactions` 等），**不要在组件中直接调用裸 `fetch` 或裸 `axios`**。
  - 新增业务场景时，优先在 `frontend/lib/swr` 中按领域增加专用 Hook（参考 `use-credits.ts`, `use-provider-keys.ts`, `use-private-providers.ts` 等），再在组件中消费这些 Hook。
  - 与后端交互的类型统一在 `frontend/lib/api-types.ts` 中维护；新增或调整 API 时，先补充 / 更新对应 TypeScript 类型，再在 SWR Hook 和组件中引用。
  - 应用根布局已在 `frontend/app/layout.tsx` 中挂载 `SWRProvider`，页面和组件无需重复包裹 Provider。

- 国际化（i18n）规范
  - 所有用户可见文案必须通过 `useI18n()` 使用文案 key，而不是直接写死中文或英文字符串。
  - 新增页面或模块时，在 `frontend/lib/i18n/*.ts` 中对应的模块文件里补充多语言文案，并在 `frontend/lib/i18n/index.ts` 中合并导出（参考现有 `credits`, `providers`, `routing` 等模块）。
  - 导航、按钮、对话框标题等通用文案优先复用已存在的 key，避免重复定义；如需新增 key，请保证中英文都补齐。

- 性能与体验优化
  - 列表 / 表格类页面应使用分页或搜索 Hook（如 `usePaginatedData`, `useSearchData`）或带分页参数的 SWR Hook，避免一次性加载过多数据。
  - 合理选择 SWR 缓存策略：读多写少的数据使用 `static`，频繁更新的数据使用 `frequent` 或 `realtime`，并避免在每次渲染时创建新的 key 对象（尽量使用 `useMemo` 组合查询参数）。
  - 大型组件拆分为“容器组件（负责数据获取）+ 展示组件（只负责渲染）”，减少重复渲染和状态耦合。
  - 避免在客户端组件中做重计算或复杂 DOM 操作；能在服务端完成的数据准备放在 page 的服务端逻辑里完成，减轻客户端负担。

## Testing Guidelines
- Use `pytest` and `pytest-asyncio` for async tests (`@pytest.mark.asyncio`).
- Place tests under `tests/` with names like `test_<feature>.py` and `test_<case>()`.
- Add or update tests for every new endpoint, caching rule, or context behavior.
- Human developers: run `pytest` and ensure green before opening a PR.
- AI agents (Codex/LLM helpers): **must not run tests themselves**. Instead:
  - write/update tests as needed;
  - tell the user exactly which test commands to run (e.g. `pytest`, or `pytest tests/test_chat_greeting.py`);
  - ask the user to run the tests and report the result back into the conversation.

## Commit & Pull Request Guidelines
- Existing history uses short, descriptive messages (often in Chinese). Follow that style; e.g., `添加模型缓存错误处理` or `Refine session logging`.
- Keep commits focused; group related changes (code + tests + docs).
- PRs should include: purpose, high-level changes, impacted endpoints, and test summary (`pytest`, manual curl examples if behavior changed).

## Spec & Agent Workflow (.specify)
- `.specify/memory/constitution.md`: Project principles that govern code quality, testing, UX, performance, and security. Read it before large refactors or process changes.
- `.specify/templates/*.md`: Templates for specs, plans, tasks, and agent files. Update these when you change the standard development workflow.
- `.specify/scripts/bash/create-new-feature.sh`: Scaffolds a numbered feature spec and branch name. Example: `bash .specify/scripts/bash/create-new-feature.sh 'Add rate limiting' --short-name rate-limit`.
- `.specify/scripts/bash/setup-plan.sh`: Creates an implementation plan from the template for the current feature branch.

## Security & Automation
- Secrets scanning is enforced via pre-commit (`detect-secrets` with `.secrets.baseline`).
- Run `pre-commit install` once, then `pre-commit run --all-files` before pushing.
- Never commit real API keys or `.env` contents; update the baseline only to reflect intentional, non-sensitive values.
- 配置 `SECRET_KEY`：请使用系统API `POST /system/secret-key/generate` 生成随机密钥并写入 `.env`，用于对敏感标识做 HMAC/加密，不会存储明文。
- Configure `SECRET_KEY`: use system API `POST /system/secret-key/generate` to generate a random secret and put it into `.env` for HMAC/encryption of sensitive identifiers (no plaintext storage).

## AI Agent 交付要求（生产级）
- 禁止提交“最小实现”占位代码；默认交付可直接上线的生产级实现。
- 变更必须同步：代码 + 测试 + 配置/文档（如适用），缺一不可。
- 新增功能需覆盖正反向测试（含失败/降级路径）；无测试不接受交付。
- 涉及缓存/限流/计费/路由的改动必须考虑分布式一致性和降级策略，明确 Redis/DB 不可用时的 fallback。

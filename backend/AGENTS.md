# Backend (Python/FastAPI)

**FastAPI API Gateway Service**

## OVERVIEW
Python 3.12+ FastAPI 后端服务，提供 AI Gateway 功能（模型路由、计费、认证）。

## STRUCTURE
```
backend/
├── main.py           # FastAPI 入口，apiproxy 脚本目标
├── app/
│   ├── api/          # API 路由 (v1/admin, providers, etc.)
│   ├── core/         # 核心配置 (database, logging, plugins)
│   ├── deps/         # 依赖注入 (auth, db, settings)
│   ├── middleware/   # 中间件
│   ├── models/       # SQLAlchemy ORM 模型
│   ├── repositories/ # 数据访问层
│   ├── schemas/      # Pydantic DTO/Schema
│   ├── services/     # 业务逻辑层
│   ├── tasks/        # Celery 异步任务
│   └── agent_plugins/# Agent 插件扩展
├── tests/            # 测试 (unit, services, api, integration)
├── migrations/       # Alembic 数据库迁移
└── scripts/          # 运维脚本
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| API 路由 | `app/api/v1/` |
| 业务逻辑 | `app/services/` |
| 数据模型 | `app/models/`, `app/schemas/` |
| 数据库操作 | `app/repositories/` |
| 测试 | `tests/` |

## CONVENTIONS
- Python 3.12, PEP 8, 4-space indent, `snake_case`
- 路由"瘦身": API 只做入参校验，业务在 Service 层
- Pydantic Schema 放在 `app/schemas/`
- 依赖注入通过 `app/deps/`
- ORM 禁止在路由层直接使用，需通过 Repository

## ANTI-PATTERNS
- **NEVER** save provider config without verification
- **NEVER** reveal user's API Key in chat
- 禁止在 handler/transport/billing 硬编码上游配置
- 禁止明文存储 `auth_config` 密钥

## COMMANDS
```bash
# 本地开发
apiproxy
uvicorn main:app --reload

# 测试
pytest

# Docker
docker compose -f docker-compose.develop.yml up -d
```

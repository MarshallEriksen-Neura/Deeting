# 开发环境配置指南

## 环境变量管理

本项目采用**统一的环境变量管理**方式,前后端共享根目录的 `.env` 文件。

### 目录结构

```
AI-Higress-Gateway/
├── .env                          # 主环境变量文件（后端 + 前端配置源）
├── .env.example                  # 环境变量示例
├── backend/                      # 后端直接读取根目录 .env
├── frontend/
│   ├── .env.local               # 前端环境变量（由脚本自动生成）
│   └── .env.example             # 前端环境变量示例
└── scripts/
    └── sync-frontend-env.sh     # 环境变量同步脚本
```

### 配置步骤

#### 1. 配置根目录 `.env` 文件

复制示例文件并修改:

```bash
cp .env.example .env
```

编辑 `.env`,配置关键变量:

```bash
# CORS 配置（前端地址）
CORS_ALLOW_ORIGINS=http://192.168.31.145:3000

# 数据库配置
POSTGRES_HOST=192.168.31.145
POSTGRES_PASSWORD=your-password

# Redis 配置
REDIS_URL=redis://:your-password@192.168.31.145:36379/0

# 其他配置...
```

#### 2. 同步前端环境变量

运行同步脚本:

```bash
bash scripts/sync-frontend-env.sh
```

脚本会自动:
1. 从 `CORS_ALLOW_ORIGINS` 推断前端地址
2. 将端口 3000 替换为 8000 生成 API 地址
3. 生成 `frontend/.env.local` 文件

示例输出:

```
同步环境变量: /path/to/.env -> /path/to/frontend/.env.local
✓ 环境变量同步完成
  NEXT_PUBLIC_API_BASE_URL=http://192.168.31.145:8000

如需修改，请编辑根目录的 .env 文件，然后重新运行:
  bash scripts/sync-frontend-env.sh

修改后需要重启前端开发服务器:
  cd frontend && bun run dev
```

#### 3. 启动开发服务器

**后端:**

```bash
# 方式1: 使用 uvicorn
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 方式2: 使用 apiproxy 命令
apiproxy
```

**前端:**

```bash
cd frontend
bun run dev
```

### 环境变量映射关系

| 根目录 .env | 前端 .env.local | 说明 |
|------------|----------------|------|
| `CORS_ALLOW_ORIGINS` | `NEXT_PUBLIC_API_BASE_URL` | 从前端地址推断 API 地址 |
| - | `ANALYZE` | 构建分析开关（默认 false） |
| - | `SKIP_TYPE_CHECK` | 类型检查开关（默认 false） |

### 自动推断逻辑

脚本会根据 `CORS_ALLOW_ORIGINS` 自动推断 API 地址:

```bash
# 示例 1: 本地开发
CORS_ALLOW_ORIGINS=http://localhost:3000
# 推断结果: NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# 示例 2: 局域网开发
CORS_ALLOW_ORIGINS=http://192.168.31.145:3000
# 推断结果: NEXT_PUBLIC_API_BASE_URL=http://192.168.31.145:8000

# 示例 3: 生产环境
CORS_ALLOW_ORIGINS=https://app.example.com
# 推断结果: NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

### 修改环境变量

当需要修改环境变量时:

1. **编辑根目录 `.env` 文件**
2. **重新运行同步脚本**: `bash scripts/sync-frontend-env.sh`
3. **重启前端开发服务器**: `cd frontend && bun run dev`

⚠️ **注意**: 不要直接编辑 `frontend/.env.local`,该文件由脚本自动生成。

### Docker 环境

Docker 环境下,前端容器会自动从根目录 `.env` 读取环境变量,无需手动同步。

```bash
# 开发环境
IMAGE_TAG=latest docker compose -f docker-compose.develop.yml --env-file .env up -d

# 生产环境
IMAGE_TAG=latest docker compose -f docker-compose-deploy.yml --env-file .env up -d
```

### 常见问题

#### Q: 为什么前端图片无法显示?

A: Next.js 的 `<Image>` 组件需要配置 `remotePatterns`。我们的 `next.config.ts` 会从 `NEXT_PUBLIC_API_BASE_URL` 自动配置图片域名白名单。

解决方法:
1. 确保运行了 `bash scripts/sync-frontend-env.sh`
2. 重启前端开发服务器: `cd frontend && bun run dev`

#### Q: 修改 `.env` 后前端没有生效?

A: Next.js 在构建时读取环境变量,需要:
1. 重新运行同步脚本: `bash scripts/sync-frontend-env.sh`
2. 重启开发服务器: `cd frontend && bun run dev`

#### Q: 可以手动配置前端环境变量吗?

A: 可以,但不推荐。如果确实需要,可以直接编辑 `frontend/.env.local`,但下次运行同步脚本时会被覆盖。

#### Q: 生产环境如何配置?

A: 生产环境建议:
1. 使用 Docker 部署,环境变量通过 `--env-file .env` 传递
2. 或者在 CI/CD 中设置环境变量,跳过同步脚本

### 相关文件

- `.env`: 主环境变量文件
- `.env.example`: 环境变量示例
- `frontend/.env.local`: 前端环境变量（自动生成）
- `frontend/.env.example`: 前端环境变量示例
- `scripts/sync-frontend-env.sh`: 环境变量同步脚本
- `frontend/next.config.ts`: Next.js 配置（读取环境变量）
- `docs/frontend/image-hostname-config.md`: 图片域名配置文档

### 最佳实践

1. **统一管理**: 所有环境变量在根目录 `.env` 中配置
2. **自动同步**: 使用脚本同步前端环境变量,避免手动维护
3. **版本控制**: `.env` 不提交到 Git,只提交 `.env.example`
4. **文档更新**: 新增环境变量时,同步更新 `.env.example` 和文档
5. **安全性**: 敏感信息（密码、密钥）只存在于 `.env`,不要硬编码

### 开发工作流

```bash
# 1. 克隆项目
git clone <repo-url>
cd AI-Higress-Gateway

# 2. 配置环境变量
cp .env.example .env
vim .env  # 修改配置

# 3. 同步前端环境变量
bash scripts/sync-frontend-env.sh

# 4. 启动后端
cd backend
uvicorn main:app --reload

# 5. 启动前端（新终端）
cd frontend
bun run dev

# 6. 访问应用
# 前端: http://192.168.31.145:3000
# 后端: http://192.168.31.145:8000
```

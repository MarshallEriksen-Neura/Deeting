# 环境变量统一管理 - 更新日志

## 概述

实现了前后端环境变量的统一管理,通过自动化脚本从根目录 `.env` 同步配置到前端。

## 变更内容

### 1. 新增文件

- **`scripts/sync-frontend-env.sh`**: 环境变量同步脚本
  - 从根目录 `.env` 读取 `CORS_ALLOW_ORIGINS`
  - 自动推断 API 地址（将端口 3000 替换为 8000）
  - 生成 `frontend/.env.local` 文件

- **`frontend/.env.local`**: 前端环境变量（自动生成）
  - 包含 `NEXT_PUBLIC_API_BASE_URL`
  - 由同步脚本自动生成,不应手动编辑

- **`Makefile`**: 开发命令快捷方式
  - `make sync-env`: 同步环境变量
  - `make dev-frontend`: 启动前端（自动同步）
  - `make dev-backend`: 启动后端
  - `make docker-up/down`: Docker 栈管理
  - `make help`: 显示所有命令

- **`docs/development/environment-setup.md`**: 环境配置完整文档
  - 详细的配置步骤
  - 环境变量映射关系
  - 常见问题解答
  - 最佳实践

- **`docs/frontend/image-hostname-config.md`**: 图片域名配置文档
  - Next.js Image 组件配置说明
  - 动态读取环境变量的实现
  - 故障排查指南

- **`docs/CHANGELOG-env-sync.md`**: 本文档

### 2. 修改文件

- **`frontend/next.config.ts`**:
  - 修改 `images.remotePatterns` 配置
  - 从 `NEXT_PUBLIC_API_BASE_URL` 动态读取图片域名
  - 支持 HTTP/HTTPS 和自定义端口

- **`frontend/app/profile/components/avatar-upload.tsx`**:
  - 将 `<Image>` 组件改为 `<img>` 标签
  - 避免 Next.js Image 组件的域名配置问题
  - 保持与 header 头像一致的实现方式

- **`README.md`**:
  - 更新"快速开始（前端）"部分
  - 添加环境变量同步说明
  - 添加文档链接

### 3. 工作流程变更

#### 之前的流程

```bash
# 1. 配置根目录 .env
cp .env.example .env
vim .env

# 2. 手动配置前端 .env.local
cd frontend
cp .env.example .env.local
vim .env.local  # 手动填写 API 地址

# 3. 启动前端
bun run dev
```

#### 现在的流程

```bash
# 1. 配置根目录 .env
cp .env.example .env
vim .env

# 2. 自动同步前端环境变量
bash scripts/sync-frontend-env.sh

# 3. 启动前端
cd frontend
bun run dev

# 或使用 Makefile
make dev-frontend
```

## 优势

### 1. 统一管理
- 所有环境变量在根目录 `.env` 中配置
- 避免前后端配置不一致
- 减少配置文件维护成本

### 2. 自动化
- 脚本自动推断 API 地址
- 无需手动维护前端环境变量
- 减少人为错误

### 3. 开发体验
- Makefile 提供便捷命令
- 清晰的文档和示例
- 完善的故障排查指南

### 4. 安全性
- `.env.local` 在 `.gitignore` 中
- 敏感信息不会被提交
- 自动生成的文件有明确标识

## 使用示例

### 本地开发

```bash
# .env 配置
CORS_ALLOW_ORIGINS=http://localhost:3000

# 同步后生成
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 局域网开发

```bash
# .env 配置
CORS_ALLOW_ORIGINS=http://192.168.31.145:3000

# 同步后生成
NEXT_PUBLIC_API_BASE_URL=http://192.168.31.145:8000
```

### 生产环境

```bash
# .env 配置
CORS_ALLOW_ORIGINS=https://app.example.com

# 同步后生成
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

## 迁移指南

### 对于现有开发者

1. **拉取最新代码**:
   ```bash
   git pull origin main
   ```

2. **运行同步脚本**:
   ```bash
   bash scripts/sync-frontend-env.sh
   ```

3. **重启前端服务器**:
   ```bash
   cd frontend
   bun run dev
   ```

### 对于新开发者

按照 [环境配置文档](development/environment-setup.md) 操作即可。

## 故障排查

### 问题: 前端图片无法显示

**原因**: Next.js Image 组件需要配置 `remotePatterns`

**解决**:
1. 运行 `bash scripts/sync-frontend-env.sh`
2. 重启前端: `cd frontend && bun run dev`

### 问题: 修改 .env 后前端没有生效

**原因**: Next.js 在构建时读取环境变量

**解决**:
1. 重新同步: `bash scripts/sync-frontend-env.sh`
2. 重启前端: `cd frontend && bun run dev`

### 问题: API 地址推断错误

**原因**: `CORS_ALLOW_ORIGINS` 格式不正确

**解决**:
1. 检查 `.env` 中的 `CORS_ALLOW_ORIGINS` 格式
2. 确保格式为 `http://host:3000` 或 `https://host`
3. 重新运行同步脚本

## 相关文档

- [环境配置文档](development/environment-setup.md)
- [图片域名配置](../frontend/image-hostname-config.md)
- [README.md](../README.md)

## 后续计划

- [ ] 支持更多环境变量的自动同步
- [ ] 添加环境变量验证脚本
- [ ] 集成到 CI/CD 流程
- [ ] 支持多环境配置（dev/staging/prod）

## 更新时间

2025-01-XX

## 贡献者

- Kiro AI Assistant

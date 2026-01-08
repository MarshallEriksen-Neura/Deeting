# 部署文档

> Gateway 部署与运维指南

---

## 架构概览

```
                    ┌─────────────────────────────────────────────────────┐
                    │                    Load Balancer                     │
                    │                  (Nginx / HAProxy)                   │
                    └──────────────────────┬──────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
    ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
    │   Gateway API   │          │   Gateway API   │          │   Gateway API   │
    │   (FastAPI)     │          │   (FastAPI)     │          │   (FastAPI)     │
    │   Port: 8000    │          │   Port: 8000    │          │   Port: 8000    │
    └────────┬────────┘          └────────┬────────┘          └────────┬────────┘
             │                            │                            │
             └────────────────────────────┼────────────────────────────┘
                                          │
         ┌─────────────────┬──────────────┴──────────────┬─────────────────┐
         │                 │                             │                 │
         ▼                 ▼                             ▼                 ▼
   ┌───────────┐    ┌───────────┐                ┌───────────┐    ┌───────────┐
   │  Redis    │    │PostgreSQL │                │  Celery   │    │  Celery   │
   │  Cluster  │    │  Primary  │                │  Worker   │    │   Beat    │
   └───────────┘    └───────────┘                └───────────┘    └───────────┘
```

---

## 系统要求

### 硬件要求

| 组件 | 最低配置 | 推荐配置 |
|------|----------|----------|
| Gateway API | 2 CPU, 4GB RAM | 4 CPU, 8GB RAM |
| PostgreSQL | 2 CPU, 4GB RAM | 4 CPU, 16GB RAM |
| Redis | 1 CPU, 2GB RAM | 2 CPU, 4GB RAM |
| Celery Worker | 2 CPU, 4GB RAM | 4 CPU, 8GB RAM |

### 软件要求

| 软件 | 版本要求 |
|------|----------|
| Python | 3.11+ |
| PostgreSQL | 14+ |
| Redis | 6.2+ |
| Docker | 20.10+ |
| Docker Compose | 2.0+ |

---

## 快速部署

### 1. 环境准备

```bash
# 克隆代码
git clone https://github.com/your-org/ai-higress-gateway.git
cd ai-higress-gateway/backend

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 2. 配置文件

创建 `.env` 文件：

```bash
# 基础配置
PROJECT_NAME=AI Higress Gateway
DEBUG=false

# 数据库配置
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/ai_gateway

# Redis 配置
REDIS_URL=redis://localhost:6379/0

# JWT 配置 (生产环境必须配置)
JWT_SECRET_KEY=your-super-secret-key-at-least-32-chars
JWT_PRIVATE_KEY_PATH=/app/security/private.pem
JWT_PUBLIC_KEY_PATH=/app/security/public.pem

# Celery 配置
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/1

# 日志配置
LOG_LEVEL=INFO
LOG_JSON_FORMAT=true
LOG_FILE_PATH=/var/log/gateway/app.log

# 限流配置
RATE_LIMIT_EXTERNAL_RPM=60
RATE_LIMIT_INTERNAL_RPM=600

# 安全配置
OUTBOUND_WHITELIST=api.openai.com,api.anthropic.com,api.cohere.ai
```

### 3. 生成 JWT 密钥对

```bash
# 创建安全目录
mkdir -p security

# 生成 RSA 私钥
openssl genrsa -out security/private.pem 2048

# 生成公钥
openssl rsa -in security/private.pem -pubout -out security/public.pem

# 设置权限
chmod 600 security/private.pem
chmod 644 security/public.pem
```

### 4. 数据库迁移

```bash
# 创建数据库
createdb ai_gateway

# 运行迁移
alembic upgrade head
```

### 5. 启动服务

```bash
# 启动 API 服务
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# 启动 Celery Worker
celery -A app.core.celery_app worker --loglevel=info --queues=default,internal,external,billing,retry

# 启动 Celery Beat
celery -A app.core.celery_app beat --loglevel=info
```

---

## Docker 部署

### Docker Compose 配置

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  gateway:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:password@postgres:5432/ai_gateway
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
      - CELERY_RESULT_BACKEND=redis://redis:6379/1
    volumes:
      - ./security:/app/security:ro
      - ./logs:/var/log/gateway
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 4G

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: celery -A app.core.celery_app worker --loglevel=info --queues=default,internal,external,billing,retry --concurrency=4
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:password@postgres:5432/ai_gateway
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 2

  beat:
    build:
      context: .
      dockerfile: Dockerfile
    command: celery -A app.core.celery_app beat --loglevel=info
    environment:
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      - redis
    deploy:
      replicas: 1

  flower:
    image: mher/flower:0.9.7
    command: celery --broker=redis://redis:6379/1 flower --port=5555
    ports:
      - "5555:5555"
    depends_on:
      - redis

  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: ai_gateway
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

volumes:
  postgres_data:
  redis_data:
```

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY . .

# 创建日志目录
RUN mkdir -p /var/log/gateway

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

### 启动服务

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f gateway

# 运行数据库迁移
docker-compose exec gateway alembic upgrade head

# 停止服务
docker-compose down
```

---

## Kubernetes 部署

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  labels:
    app: gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
    spec:
      containers:
        - name: gateway
          image: your-registry/gateway:latest
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef:
                name: gateway-config
            - secretRef:
                name: gateway-secrets
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 5
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: gateway
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8000
  selector:
    app: gateway
```

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: gateway-config
data:
  LOG_LEVEL: "INFO"
  LOG_JSON_FORMAT: "true"
  RATE_LIMIT_EXTERNAL_RPM: "60"
  RATE_LIMIT_INTERNAL_RPM: "600"
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: gateway-secrets
type: Opaque
stringData:
  DATABASE_URL: postgresql+asyncpg://user:pass@postgres:5432/db
  REDIS_URL: redis://redis:6379/0
  JWT_SECRET_KEY: your-secret-key
```

---

## 配置参考

### 完整配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PROJECT_NAME` | AI Higress Gateway | 项目名称 |
| `API_V1_STR` | /api/v1 | API 路径前缀 |
| `DEBUG` | false | 调试模式 |
| `DATABASE_URL` | - | PostgreSQL 连接字符串 |
| `REDIS_URL` | redis://localhost:6379/0 | Redis 连接字符串 |
| `CACHE_PREFIX` | ai_gateway: | 缓存键前缀 |
| `CACHE_DEFAULT_TTL` | 300 | 默认缓存 TTL（秒） |
| `RATE_LIMIT_EXTERNAL_RPM` | 60 | 外部通道 RPM |
| `RATE_LIMIT_INTERNAL_RPM` | 600 | 内部通道 RPM |
| `RATE_LIMIT_EXTERNAL_TPM` | 100000 | 外部通道 TPM |
| `RATE_LIMIT_INTERNAL_TPM` | 1000000 | 内部通道 TPM |
| `MAX_REQUEST_BYTES` | 524288 | 最大请求体（512KB） |
| `MAX_RESPONSE_BYTES` | 2097152 | 最大响应体（2MB） |
| `GATEWAY_MAX_CONCURRENCY` | 200 | 最大并发数 |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | 5 | 熔断失败阈值 |
| `CIRCUIT_BREAKER_RESET_SECONDS` | 30 | 熔断重置时间 |
| `LOG_LEVEL` | INFO | 日志级别 |
| `LOG_JSON_FORMAT` | false | JSON 格式日志 |
| `JWT_ALGORITHM` | RS256 | JWT 算法 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 30 | Access Token 有效期 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | 7 | Refresh Token 有效期 |

### Celery 队列配置

| 队列 | 用途 |
|------|------|
| `default` | 默认任务 |
| `internal` | 内部任务（审计、报表） |
| `external` | 外部任务（推理、回调、媒体） |
| `billing` | 计费任务 |
| `retry` | 重试任务（上游重试） |

---

## 健康检查

### API 健康检查

```bash
# 简单健康检查
curl http://localhost:8000/health

# 详细健康检查
curl http://localhost:8000/ready
```

### 组件健康检查

```bash
# PostgreSQL
pg_isready -h localhost -p 5432

# Redis
redis-cli ping

# Celery
celery -A app.core.celery_app inspect ping
```

---

## 扩容指南

### 水平扩容

```bash
# Docker Compose
docker-compose up -d --scale gateway=5 --scale worker=3

# Kubernetes
kubectl scale deployment gateway --replicas=5
kubectl scale deployment worker --replicas=3
```

### 垂直扩容

调整资源限制：

```yaml
# docker-compose.yml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 8G
```

---

## 备份与恢复

### 数据库备份

```bash
# 备份
pg_dump -h localhost -U postgres ai_gateway > backup_$(date +%Y%m%d).sql

# 恢复
psql -h localhost -U postgres ai_gateway < backup_20260106.sql
```

### Redis 备份

```bash
# RDB 快照
redis-cli BGSAVE

# 备份文件
cp /var/lib/redis/dump.rdb /backup/redis_$(date +%Y%m%d).rdb
```

---

## 安全加固

### 1. 网络安全

- 使用内网部署，仅暴露负载均衡器
- 配置防火墙规则
- 启用 HTTPS（TLS 1.2+）

### 2. 数据库安全

- 使用强密码
- 限制数据库访问 IP
- 定期备份

### 3. 应用安全

- 定期更新依赖
- 启用日志审计
- 配置上游白名单

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*

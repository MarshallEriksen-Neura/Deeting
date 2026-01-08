# 运维操作手册 (Runbook)

> Gateway 日常运维操作指南

---

## 目录

1. [日常运维](#一日常运维)
2. [故障响应](#二故障响应)
3. [扩缩容操作](#三扩缩容操作)
4. [配置变更](#四配置变更)
5. [数据库运维](#五数据库运维)
6. [Redis 运维](#六redis-运维)
7. [Celery 运维](#七celery-运维)
8. [安全操作](#八安全操作)

---

## 一、日常运维

### 1.1 服务状态检查

```bash
# 检查所有服务状态
docker-compose ps

# 检查 API 健康
curl -s http://localhost:8000/health | jq

# 检查 Redis
redis-cli ping

# 检查 PostgreSQL
pg_isready -h localhost -p 5432

# 检查 Celery Worker
celery -A app.core.celery_app inspect ping
```

### 1.2 日志查看

```bash
# API 日志
tail -f /var/log/gateway/app.log

# Docker 日志
docker-compose logs -f gateway

# 按 trace_id 查询
grep "trace_id=req-abc123" /var/log/gateway/app.log

# 查看错误日志
grep "ERROR" /var/log/gateway/app.log | tail -100

# JSON 格式日志分析
jq 'select(.level == "ERROR")' /var/log/gateway/app.log | tail -20
```

### 1.3 指标查看

```bash
# Prometheus 指标
curl -s http://localhost:8000/metrics | grep gateway

# 关键指标
curl -s http://localhost:8000/metrics | grep -E "gateway_request_total|gateway_upstream_latency"
```

### 1.4 每日巡检清单

```markdown
- [ ] 服务健康检查通过
- [ ] 错误率 < 0.1%
- [ ] P95 延迟 < 2s
- [ ] Redis 内存使用 < 80%
- [ ] PostgreSQL 连接数正常
- [ ] Celery 队列积压 < 100
- [ ] 磁盘空间 > 20%
- [ ] 无告警未处理
```

---

## 二、故障响应

### 2.1 服务不可用

**症状**: API 无响应或返回 503

**快速恢复**:
```bash
# 1. 检查服务状态
docker-compose ps

# 2. 重启服务
docker-compose restart gateway

# 3. 检查依赖
redis-cli ping
pg_isready -h localhost

# 4. 查看日志
docker-compose logs --tail=100 gateway
```

**排查要点**:
- 检查 Redis/PostgreSQL 连接
- 检查内存/CPU 使用
- 检查端口占用
- 检查配置文件

### 2.2 响应延迟高

**症状**: P95 > 5s

**快速定位**:
```bash
# 查看慢请求
grep "latency_ms" /var/log/gateway/app.log | \
  awk -F'latency_ms=' '{if($2>5000) print}' | tail -20

# 检查上游状态
curl -s http://localhost:8000/metrics | grep upstream_latency

# 检查数据库慢查询
psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 seconds'"
```

**缓解措施**:
```bash
# 1. 增加实例数
docker-compose up -d --scale gateway=5

# 2. 重启慢实例
docker-compose restart gateway

# 3. 检查上游是否降级
# 查看熔断状态
redis-cli KEYS "gw:circuit:*"
```

### 2.3 错误率飙升

**症状**: 5xx 错误率 > 1%

**快速定位**:
```bash
# 按错误码统计
grep "ERROR" /var/log/gateway/app.log | \
  grep -oP 'error_code=\K\w+' | sort | uniq -c | sort -rn

# 按上游统计
grep "upstream_error" /var/log/gateway/app.log | \
  grep -oP 'provider=\K\w+' | sort | uniq -c | sort -rn
```

**缓解措施**:
```bash
# 1. 检查上游状态
curl -I https://api.openai.com/v1/models

# 2. 手动触发熔断（如果需要）
redis-cli SET "gw:circuit:openai:gpt-4" "OPEN" EX 300

# 3. 切换备用上游
# 通过调整 provider_preset 权重
```

### 2.4 内存不足

**症状**: OOM Killer 终止进程

**快速恢复**:
```bash
# 1. 重启服务
docker-compose restart gateway

# 2. 增加内存限制
docker-compose up -d --scale gateway=3
```

**预防措施**:
```yaml
# docker-compose.yml
deploy:
  resources:
    limits:
      memory: 4G
    reservations:
      memory: 2G
```

### 2.5 数据库连接耗尽

**症状**: "too many connections" 错误

**快速恢复**:
```bash
# 1. 查看连接数
psql -c "SELECT count(*) FROM pg_stat_activity"

# 2. 终止空闲连接
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes'"

# 3. 重启应用
docker-compose restart gateway
```

**长期修复**:
```bash
# 增加 PostgreSQL 最大连接数
# postgresql.conf
max_connections = 200

# 调整应用连接池
DATABASE_URL=postgresql+asyncpg://...?min_size=10&max_size=50
```

---

## 三、扩缩容操作

### 3.1 水平扩容

```bash
# Docker Compose
docker-compose up -d --scale gateway=5 --scale worker=3

# Kubernetes
kubectl scale deployment gateway --replicas=5
kubectl scale deployment worker --replicas=3

# 验证
docker-compose ps
kubectl get pods -l app=gateway
```

### 3.2 缩容

```bash
# 优雅缩容（等待请求完成）
docker-compose up -d --scale gateway=2

# Kubernetes
kubectl scale deployment gateway --replicas=2

# 验证无流量后再缩容
curl -s http://localhost:8000/metrics | grep gateway_request_total
```

### 3.3 滚动更新

```bash
# Docker Compose
docker-compose pull gateway
docker-compose up -d --no-deps gateway

# Kubernetes
kubectl set image deployment/gateway gateway=image:new-tag
kubectl rollout status deployment/gateway
```

---

## 四、配置变更

### 4.1 环境变量更新

```bash
# 1. 更新 .env 文件
vim .env

# 2. 重启服务
docker-compose up -d

# 3. 验证配置
docker-compose exec gateway env | grep RATE_LIMIT
```

### 4.2 限流配置调整

```bash
# 修改 API Key 限流
curl -X PUT "http://localhost:8000/api/v1/admin/api-keys/{id}/rate-limit" \
  -H "Authorization: Bearer $TOKEN" \
  -d "rpm=100&tpm=200000"

# 全局限流（需重启）
# .env
RATE_LIMIT_EXTERNAL_RPM=100
```

### 4.3 上游配置调整

```sql
-- 更新 provider_preset 权重
UPDATE provider_preset_item
SET weight = 100
WHERE id = 'item-uuid';

-- 禁用某个上游
UPDATE provider_preset_item
SET is_active = false
WHERE provider = 'problematic-provider';
```

```bash
# 清除路由缓存
redis-cli KEYS "gw:routing:*" | xargs redis-cli DEL
```

---

## 五、数据库运维

### 5.1 备份

```bash
# 全量备份
pg_dump -h localhost -U postgres ai_gateway > backup_$(date +%Y%m%d_%H%M%S).sql

# 压缩备份
pg_dump -h localhost -U postgres ai_gateway | gzip > backup_$(date +%Y%m%d).sql.gz

# 定时备份 (crontab)
0 2 * * * /usr/bin/pg_dump -h localhost -U postgres ai_gateway | gzip > /backup/ai_gateway_$(date +\%Y\%m\%d).sql.gz
```

### 5.2 恢复

```bash
# 从备份恢复
psql -h localhost -U postgres ai_gateway < backup_20260106.sql

# 从压缩备份恢复
gunzip -c backup_20260106.sql.gz | psql -h localhost -U postgres ai_gateway
```

### 5.3 迁移

```bash
# 查看迁移状态
alembic current

# 执行迁移
alembic upgrade head

# 回滚迁移
alembic downgrade -1

# 生成新迁移
alembic revision --autogenerate -m "add_new_column"
```

### 5.4 性能优化

```sql
-- 查看慢查询
SELECT query, calls, mean_time, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 重建索引
REINDEX INDEX idx_gateway_log_created_at;

-- 清理死元组
VACUUM ANALYZE gateway_log;
```

---

## 六、Redis 运维

### 6.1 监控

```bash
# 内存使用
redis-cli INFO memory | grep used_memory_human

# 连接数
redis-cli INFO clients | grep connected_clients

# 命中率
redis-cli INFO stats | grep keyspace

# 慢查询
redis-cli SLOWLOG GET 10
```

### 6.2 清理

```bash
# 清理特定前缀的键
redis-cli KEYS "gw:cache:*" | xargs redis-cli DEL

# 清理过期键（触发惰性删除）
redis-cli DEBUG SLEEP 0

# 清理限流计数器（谨慎）
redis-cli KEYS "gw:rl:*" | xargs redis-cli DEL
```

### 6.3 故障恢复

```bash
# 重启 Redis
systemctl restart redis

# 从 RDB 恢复
cp /backup/dump.rdb /var/lib/redis/
systemctl restart redis

# 主从切换（Sentinel）
redis-cli -p 26379 SENTINEL failover mymaster
```

---

## 七、Celery 运维

### 7.1 监控

```bash
# Worker 状态
celery -A app.core.celery_app inspect active

# 队列长度
redis-cli LLEN celery
redis-cli LLEN billing
redis-cli LLEN internal

# Flower UI
# 访问 http://localhost:5555
```

### 7.2 队列管理

```bash
# 清空队列（谨慎）
celery -A app.core.celery_app purge

# 清空特定队列
redis-cli DEL billing

# 重新分发任务
celery -A app.core.celery_app control rate_limit "app.tasks.billing.*" "50/s"
```

### 7.3 Worker 管理

```bash
# 重启 Worker
celery -A app.core.celery_app control shutdown
celery -A app.core.celery_app worker --loglevel=info &

# 增加并发
celery -A app.core.celery_app control pool_grow 4

# 减少并发
celery -A app.core.celery_app control pool_shrink 2
```

---

## 八、安全操作

### 8.1 API Key 管理

```bash
# 吊销 API Key
curl -X POST "http://localhost:8000/api/v1/admin/api-keys/{id}/revoke" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reason": "Security incident"}'

# 轮换 API Key
curl -X POST "http://localhost:8000/api/v1/admin/api-keys/{id}/rotate?grace_period_hours=24" \
  -H "Authorization: Bearer $TOKEN"

# 解冻 API Key
# 需要直接更新数据库
UPDATE api_key SET status = 'active' WHERE id = 'key-uuid';
```

### 8.2 JWT 密钥轮换

```bash
# 1. 生成新密钥
openssl genrsa -out security/private_new.pem 2048
openssl rsa -in security/private_new.pem -pubout -out security/public_new.pem

# 2. 更新配置（保留旧密钥用于验证）
mv security/private.pem security/private_old.pem
mv security/public.pem security/public_old.pem
mv security/private_new.pem security/private.pem
mv security/public_new.pem security/public.pem

# 3. 重启服务
docker-compose restart gateway

# 4. 等待旧 Token 过期后删除旧密钥
```

### 8.3 安全审计

```bash
# 查看登录失败记录
grep "login_failed" /var/log/gateway/app.log | tail -100

# 查看签名失败记录
grep "signature_failed" /var/log/gateway/app.log | tail -100

# 查看被限流的请求
grep "RATE_LIMIT" /var/log/gateway/app.log | tail -100

# 导出审计日志
psql -c "COPY (SELECT * FROM gateway_log WHERE created_at > now() - interval '7 days') TO '/tmp/audit_export.csv' WITH CSV HEADER"
```

### 8.4 紧急封禁

```bash
# 封禁 API Key
curl -X POST "http://localhost:8000/api/v1/admin/api-keys/{id}/revoke" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reason": "Abuse detected"}'

# 封禁 IP（通过 Redis）
redis-cli SET "gw:blocked:ip:1.2.3.4" "1" EX 86400

# 封禁用户
UPDATE users SET is_active = false WHERE id = 'user-uuid';
```

---

## 附录：常用命令速查

```bash
# 服务管理
docker-compose up -d                    # 启动服务
docker-compose down                     # 停止服务
docker-compose restart gateway          # 重启 gateway
docker-compose logs -f gateway          # 查看日志

# 数据库
alembic upgrade head                    # 数据库迁移
pg_dump ai_gateway > backup.sql         # 备份
psql ai_gateway < backup.sql            # 恢复

# Redis
redis-cli INFO                          # 查看状态
redis-cli KEYS "gw:*"                   # 查看键
redis-cli FLUSHDB                       # 清空（危险）

# Celery
celery -A app.core.celery_app inspect ping      # 检查状态
celery -A app.core.celery_app purge             # 清空队列
celery -A app.core.celery_app control shutdown  # 停止 worker

# 监控
curl http://localhost:8000/health       # 健康检查
curl http://localhost:8000/metrics      # 指标
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*

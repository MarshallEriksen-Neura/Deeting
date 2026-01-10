# 上游代理日志增强

## 概述

为了更好地追踪和调试聊天请求使用的代理情况,我们在 `metrics_service.py` 中增强了代理使用的日志记录。

## 修改内容

### 1. 非流式请求日志增强

在 `call_upstream_http_with_metrics` 函数中添加了以下日志:

- **使用代理时**: 记录代理 URL(脱敏)、provider、logical_model、尝试次数
  ```
  call_upstream_http_with_metrics: 使用代理 http://***:***@proxy.example.com:8080 请求上游 https://api.provider.com/v1/chat/completions (provider=provider-1 logical_model=gpt-4 attempt=1/3)
  ```

- **代理请求成功**: 记录代理 URL、provider、logical_model、HTTP 状态码
  ```
  call_upstream_http_with_metrics: 代理 http://***:***@proxy.example.com:8080 请求成功 (provider=provider-1 logical_model=gpt-4 status=200)
  ```

- **代理池不可用回退直连**: 明确标识使用直连
  ```
  call_upstream_http_with_metrics: 代理池不可用,使用直连请求上游 https://api.provider.com/v1/chat/completions (provider=provider-1 logical_model=gpt-4)
  ```

- **未启用代理**: 明确标识未启用代理
  ```
  call_upstream_http_with_metrics: 未启用代理,使用直连请求上游 https://api.provider.com/v1/chat/completions (provider=provider-1 logical_model=gpt-4)
  ```

- **直连请求成功**: 记录直连成功状态
  ```
  call_upstream_http_with_metrics: 直连请求成功 (provider=provider-1 logical_model=gpt-4 status=200)
  ```

### 2. 流式请求日志增强

在 `stream_upstream_with_metrics` 函数中添加了以下日志:

- **使用代理时**: 记录代理 URL(脱敏)、provider、logical_model、尝试次数
  ```
  stream_upstream_with_metrics: 使用代理 http://***:***@proxy.example.com:8080 连接上游 https://api.provider.com/v1/chat/completions (provider=provider-1 logical_model=gpt-4 attempt=1/3)
  ```

- **代理首包到达**: 记录代理 URL、provider、logical_model、TTFB(首字节时间)
  ```
  stream_upstream_with_metrics: 代理 http://***:***@proxy.example.com:8080 首包到达 (provider=provider-1 logical_model=gpt-4 ttfb=245.32ms)
  ```

- **代理池不可用回退直连**: 明确标识使用直连
  ```
  stream_upstream_with_metrics: 代理池不可用,使用直连连接上游 https://api.provider.com/v1/chat/completions (provider=provider-1 logical_model=gpt-4)
  ```

- **未启用代理**: 明确标识未启用代理
  ```
  stream_upstream_with_metrics: 未启用代理,使用直连连接上游 https://api.provider.com/v1/chat/completions (provider=provider-1 logical_model=gpt-4)
  ```

- **直连首包到达**: 记录直连 TTFB
  ```
  stream_upstream_with_metrics: 直连首包到达 (provider=provider-1 logical_model=gpt-4 ttfb=189.45ms)
  ```

## 日志级别

所有新增的日志都使用 `logger.info` 级别,确保在生产环境中可以看到代理使用情况。原有的 `logger.debug` 级别日志已升级为 `logger.info`。

## 代理 URL 脱敏

所有日志中的代理 URL 都通过 `mask_proxy_url()` 函数进行脱敏处理,隐藏用户名和密码信息,例如:
- 原始: `http://user:pass@proxy.example.com:8080`
- 脱敏: `http://***:***@proxy.example.com:8080`

## 日志分类

根据 `logging_config.py` 中的 `infer_log_business()` 函数,这些日志会被归类到:
- `upstream.log`: 上游代理相关日志
- `chat.log`: 聊天路由相关日志

## 使用场景

这些日志可以帮助:
1. **调试代理问题**: 快速定位哪个代理被使用,是否成功
2. **性能分析**: 对比代理和直连的延迟差异
3. **故障排查**: 了解代理池状态,是否发生回退
4. **审计追踪**: 记录每次请求使用的代理信息

## 相关文件

- `backend/app/services/metrics_service.py`: 主要修改文件
- `backend/app/proxy_pool.py`: 代理选择逻辑
- `backend/app/services/upstream_proxy_utils.py`: 代理 URL 脱敏工具
- `backend/app/logging_config.py`: 日志配置和分类

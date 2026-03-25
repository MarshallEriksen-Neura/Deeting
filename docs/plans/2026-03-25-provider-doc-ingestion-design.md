# Provider Documentation Ingestion Design

Date: 2026-03-25

## Summary

`provider_registry` 继续只负责 provider schema 对齐、模板验证、preset 发布，不承担网页抓取职责。为了让 AI 更稳定地“看文档 -> 提炼协议 -> 生成候选 preset”，需要在它前面补一条独立的 `provider_doc_ingestion` 流水线。

这条流水线的目标不是生成一段摘要，而是生成一份可以直接交给桌面端 `provider_registry` 继续验证的结构化产物：

- `ProviderExtractionReport`
- `ProviderPresetCandidate`
- `verification_gaps`

本轮火山引擎 LAS 文档试跑说明，这个方向是可行的，但必须采用“字段级抽取 + 证据锚点 + explicit/inferred 区分”的工业化方式，不能靠普通网页总结。

## Why now

当前 provider 接入虽然已经有比较完整的桌面端验证与发布链路，但“前置知识采集”仍然是手工的：

- AI 可以浏览文档，但没有统一 extraction contract。
- `provider_registry` 已经有 `get_unified_schema`、`verify_provider_template`、`save_provider_to_marketplace`，但它的输入仍然依赖人或模型手工整理。
- `crawler` 能抓网页，但它输出的是网页内容，不是 provider protocol candidate。

结果是：

- 生成质量高度依赖模型临场发挥。
- 同一个 provider 的不同页面很容易被混在一起。
- 模型会把“文档明确写了什么”和“根据 OpenAI 兼容推断了什么”混成一个答案。
- 最终产物很难直接映射到桌面端真实需要的字段。

## Goals

- 保持 `provider_registry` 的职责单一，不把 crawler 逻辑塞进去。
- 引入一条独立的 `provider_doc_ingestion` 官方 skill，用于 provider 文档抓取、证据提取、候选结构生成。
- 让 AI 输出 evidence-first 的结构化结果，而不是自由摘要。
- 让输出天然对齐桌面端真正消费的 provider profile 字段。
- 让候选结果能自然流入 `verify_provider_template` 的 dry-run 验证。

## Non-Goals

- 本轮不把 `provider_registry` 改造成爬虫。
- 本轮不自动绕过验证直接发布 preset。
- 本轮不构建通用知识库产品面。
- 本轮不做“任意网站都能百分之百抽全协议”的承诺。
- 本轮不引入云端工作流依赖，默认以桌面本地 official skill 运行。

## Current seams

### 1. `provider_registry` 已经是 provider-only lane

当前 `provider_registry` 的真实职责很清楚：

- `get_unified_schema`
- `verify_provider_template`
- `save_provider_to_marketplace`

它解决的是“目标结构是什么”和“候选配置能不能跑通”，不是“怎么从文档里把候选结构捞出来”。

### 2. `crawler` 解决的是内容获取，不是协议结构化

`crawler` 更像 acquisition lane：

- 抓 HTML / Markdown
- 把站点内容带回来

但它没有 provider-specific schema，也不会输出：

- auth contract
- base_url normalization
- protocol family
- capability-specific required/optional request fields
- evidence confidence

### 3. 桌面端真正消费的是结构化 protocol profile

桌面 runtime 真正要用的不是“这篇文档的大意”，而是：

- `base_url`
- `transport.path`
- `auth_type`
- `request_template`
- `response mapping`
- capability scope

因此 ingestion lane 的输出必须天然面向这些字段。

## Trial: Volcengine LAS

本轮对火山引擎 LAS 文档做了真实试跑，核心页面包括：

- 调用方式
- Chat API
- OpenAI SDK 兼容说明

### Stable wins

可以稳定抽出的字段包括：

- regional `Base URL`
- `Authorization: Bearer <ARK_API_KEY>`
- `Path: /api/v1/chat/completions`
- `Method: POST`
- `Content-Type: application/json`
- `messages`
- `model`
- `thinking`
- `stream`
- `max_tokens`
- `temperature`

### Observed problems

- 站点是前端渲染壳，普通 HTML 抓取噪音大。
- 不同页面承担的信息不同，不能只抓一页。
- 响应 schema、stream event schema、error schema 不一定在同一页。
- 如果让模型自由总结，它很容易丢失证据边界。

### Conclusion from trial

火山引擎这类站点已经证明：

- “字段级采集卡”是有效的。
- “普通总结”是不够的。
- 只要 extraction contract 对齐桌面端目标结构，模型可以产出可用的 candidate。

## Target architecture

### 1. Acquisition plane

新增 `provider_doc_ingestion` 官方 skill，默认使用桌面端可调用能力完成网页采集：

- 优先使用 `web.fetch`
- 需要时可回落到 `crawler` / Scout
- 每个页面保存原始内容与来源 URL

这一层只负责“拿回内容”，不负责做 provider 判断。

### 2. Evidence extraction plane

采集后的内容进入统一 extraction contract：

- 按字段提取，不按文章总结
- 每个字段都要有 `source_url`
- 每个字段都要有 `source_snippet`
- 每个字段都要标 `explicit` 或 `inferred`
- 每个字段都要有 `confidence`

输出对象定义为 `ProviderExtractionReport`。

### 3. Candidate synthesis plane

在 evidence 足够时，将 `ProviderExtractionReport` 转成 `ProviderPresetCandidate`：

- `provider`
- `display_name`
- `base_url`
- `protocol_profiles`
- `auth_type`
- `auth_header`
- `capabilities`
- `test_payloads`

这一层负责 normalization，例如：

- 如果文档示例给的是 `https://host/api/v1` + `client.chat.completions.create(...)`，则可推导出：
  - `base_url = https://host/api/v1`
  - `transport.path = chat/completions`
- 如果文档示例给的是 host 根路径和完整 curl path，则可推导出：
  - `base_url = https://host`
  - `transport.path = api/v1/chat/completions`

### 4. Verification gate

`ProviderPresetCandidate` 不可直接发布，必须走验证门：

- 先经 `provider_registry.get_unified_schema` 对齐目标 contract
- 再经 `provider_registry.verify_provider_template` 做 dry-run
- 验证失败则只保留 candidate，不允许进入 publish

### 5. Publish handoff

验证通过后，才由现有 `provider_registry` 完成：

- `save_provider_to_marketplace`

也就是说，最终发布 lane 不变，只是前面多了一条可工业化重复执行的“候选生成”链路。

## Data contracts

### `ProviderExtractionReport`

```json
{
  "provider_identity": {
    "provider": "volcengine_las",
    "product_name": "LAS",
    "doc_base_url": "https://www.volcengine.com/docs/6492"
  },
  "auth": {
    "auth_type": "api_key",
    "header_name": "Authorization",
    "header_scheme": "Bearer",
    "env_key_hint": "ARK_API_KEY"
  },
  "capabilities": {
    "chat": {
      "base_url": "https://operator.las.cn-beijing.volces.com",
      "transport": {
        "method": "POST",
        "path": "/api/v1/chat/completions",
        "content_type": "application/json"
      },
      "request_fields": {
        "required": ["model", "messages"],
        "optional": ["thinking", "stream", "max_tokens", "temperature"]
      }
    }
  },
  "evidence": [
    {
      "field": "chat.transport.path",
      "value": "/api/v1/chat/completions",
      "source_url": "https://www.volcengine.com/docs/6492/2192011",
      "source_snippet": "Path: /api/v1/chat/completions",
      "confidence": "high",
      "explicit_or_inferred": "explicit"
    }
  ],
  "gaps": [
    "response_schema",
    "stream_event_schema",
    "error_schema"
  ]
}
```

### `ProviderPresetCandidate`

```json
{
  "slug": "volcengine-las-chat",
  "name": "Volcengine LAS Chat",
  "provider": "volcengine_las",
  "base_url": "https://operator.las.cn-beijing.volces.com",
  "auth_type": "api_key",
  "protocol_profiles": {
    "chat": {
      "protocol_family": "openai_chat",
      "transport": {
        "path": "api/v1/chat/completions"
      }
    }
  },
  "verification_ready": false,
  "verification_gaps": [
    "response_template not confirmed",
    "stream decoder not confirmed"
  ]
}
```

## Extraction rules

### Non-negotiable rules

- 不允许把 inference 写成 explicit。
- 不允许把 marketing 文案当协议字段。
- 不允许在证据不足时直接生成 publish-ready preset。
- 不允许跳过 `verify_provider_template`。

### Confidence rules

- `high`: 文档直接给出字段和值。
- `medium`: 文档示例和说明共同支持该结论，但不是单点直写。
- `low`: 只能根据兼容关系推断，默认应进入 `gaps` 而不是 candidate final。

## Official skill shape

建议新增官方 skill：

- package: `packages/official-skills/provider_doc_ingestion`
- runtime: `local`
- role: provider 文档采集与 candidate 生成

建议提供的 tool surface：

- `collect_provider_doc_evidence`
- `draft_provider_candidate`
- `score_provider_candidate_readiness`

这里的 `readiness` 不是“能不能发布”，而是：

- `evidence_ready`
- `candidate_ready`
- `verify_ready`

## First implementation slice

首个实现切片只做最小闭环：

1. 新建 `provider_doc_ingestion` 官方 skill
2. 固化 extraction schema 与 prompt template
3. 实现针对若干页面 URL 的 evidence extraction
4. 输出 candidate JSON
5. 增加 Volcengine LAS fixture / example
6. 不自动 publish，只输出 verify-ready candidate

## Risks

- 某些站点正文依赖 JS 渲染，`web.fetch` 不一定稳定提取。
- response schema 经常分散在多个页面，candidate 可能长期保持 partial。
- 不同 provider 的 OpenAI-compatible 程度不同，`protocol_family` 不能只靠品牌猜。
- 当前 `crawler` skill 运行依赖需要显式健康检查，否则环境问题会被误判为抓取失败。

## Decision

这条线的核心决策是：

> `provider_registry` 不扩 scope；新增 `provider_doc_ingestion` 作为它前面的工业化采集层。

这样可以同时保住两件事：

- `provider_registry` 继续是干净的 provider control-plane lane
- AI 又能通过标准采集卡稳定地产出可验证的 provider candidate

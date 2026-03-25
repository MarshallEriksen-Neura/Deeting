# Desktop Scout Crawler Output Hardening Design

Date: 2026-03-25

## Summary

当前 `provider_doc_ingestion -> web.fetch -> official.skills.crawler -> Scout /v1/scout/inspect` 这条桌面本地链路存在两个已经暴露出的生产问题：

- 部分页面抓取成功，部分页面因为 `U+200B` 等零宽字符在 Windows `GBK` stdout 环境下触发 `UnicodeEncodeError`
- 即使抓取成功，`title` 也可能在 `Scout API -> crawler skill` 这段 contract 中丢失，最终表现为 `title: null`

这不是单点 bug，而是三层边界同时存在缺口：

- `Scout` 负责内容产出，但没有做稳定的文本规范化，也没有把 `title` 作为稳定顶层字段返回
- `official.skills.crawler` 负责本地 skill 出口，但直接把富文本结果按当前进程 stdout 编码输出，没有稳定的 UTF-8 保障与错误分类
- `desktop runtime` 负责启动 Python skill，但没有为本地 Python skill 提供统一的 UTF-8 I/O 运行时约束

本设计的目标是把这条高频使用链路收敛成一个生产级 contract，而不是补一个“把某个字符替换掉”的临时修复。

## Why now

这条链已经不是边角功能，而是桌面端多类官方能力的基础获取通道：

- `provider_doc_ingestion` 依赖它批量采集 provider 文档
- 其他需要 `web.fetch` 的官方 skill 也会共享同一条桌面抓取出口
- 用户会高频率在本地桌面端用它处理复杂文档站点，而不是低频手工操作

如果继续保持“Scout 原样返回，crawler 原样 print，runtime 原样继承本机 locale”的状态，后续还会不断出现：

- 页面偶发失败但难以归因
- 不同机器、不同 code page 下行为不一致
- skill 结果 schema 漂移导致上层 ingestion 逻辑出现空字段或脏数据

## Goals

- 为 `Scout -> crawler skill -> desktop runtime` 建立稳定、明确、可观测的文本输出 contract
- 让零宽字符、BOM、异常换行等网页常见噪声不再导致 skill 输出失败
- 让 `title`、`markdown`、`metadata` 的 contract 在 Scout 与 crawler 之间保持一致
- 让桌面端 Python skill 的 stdout/stderr 编码从“依赖系统 locale”收敛为“明确的 UTF-8”
- 给编码/序列化类故障增加结构化分类与测试覆盖

## Non-Goals

- 不改变 Scout 作为网页抓取服务的核心职责
- 不把 `provider_doc_ingestion` 自己改成直接访问网页的独立抓取器
- 不在本轮引入云端代理或后端中转来绕过桌面本地 skill 运行
- 不做“删除所有非 ASCII 字符”的破坏性清洗

## Current failure boundary

### 1. `provider_doc_ingestion` 不是根因层

`provider_doc_ingestion` 只做两件事：

- 调用 `deeting.call_tool("web.fetch", ...)`
- 收集返回内容并进入后续 extraction lane

它本身既不负责网页解析，也不负责 skill 子进程 stdout 编码。

### 2. `Scout` 返回的是原始 `crawl4ai` markdown

`Scout` 当前在 `CrawlerService` 中直接把 `result.markdown` 返回给 API 层，API 层再继续回传。这里没有：

- 零宽字符清洗
- 文本规范化统计
- 顶层 `title` 的稳定 contract

结果是脏字符能一路透传，而 `title` 又在 API 封装时被缩进到了一个不稳定的结构里。

### 3. `official.skills.crawler` 在 stdout 边界失败

`official.skills.crawler` 当前会：

- 调用 Scout `/v1/scout/inspect`
- 读取 JSON
- 直接 `print(json.dumps(result, ensure_ascii=False))`

当返回内容包含 `GBK` 无法编码的字符时，Python 会在 stdout 写出阶段报错。这时桌面 runtime 只能收到 skill 失败，而不是收到一个可恢复的结构化结果。

### 4. `desktop runtime` 没有强约束 Python I/O 编码

桌面端本地 skill 运行环境当前只负责注入 skill id、action id、Scout URL、PYTHONPATH 等内容，没有统一注入：

- `PYTHONIOENCODING=utf-8`
- `PYTHONUTF8=1`

这意味着 skill 子进程输出行为会被本机 locale / code page 影响，尤其是 Windows。

## Production design

### Layer 1: Scout output contract hardening

在 `Scout` 侧新增一个稳定的文本规范化层，位置放在 `CrawlerService` 返回 API 之前。

这层职责：

- 对 `markdown` 做轻量、可解释的规范化
- 统一返回稳定的顶层 `title`
- 在 `metadata` 里记录 normalization 结果，便于调试和观测

规范化规则建议：

- 去除 UTF-8 BOM
- 去除默认不应出现在正文里的零宽字符：
  - `U+200B`
  - `U+200C`
  - `U+200D`
  - `U+FEFF`
- 统一换行到 `\n`
- 保留正常中文、emoji、数学符号等合法 Unicode 文本

新增输出字段建议：

```json
{
  "status": "success",
  "title": "Page title",
  "markdown": "...normalized markdown...",
  "metadata": {
    "media_count": 3,
    "link_count": 17,
    "normalization": {
      "removed_zero_width_chars": 4,
      "removed_bom": false,
      "normalized_newlines": true
    }
  }
}
```

这里的重点不是“偷偷清洗”，而是“明确清洗并保留审计信息”。

### Layer 2: Crawler skill transport hardening

`official.skills.crawler` 需要从“简单脚本”升级为“稳定的 transport adapter”。

核心改动：

- 新增统一 JSON emitter，而不是在 `handle_input()` 末尾直接 `print(...)`
- skill 启动后优先显式重配 stdout/stderr 到 UTF-8
- 读取 Scout 返回时优先消费 top-level `title`，兼容旧结构时再 fallback 到 `metadata.title`
- 对异常做结构化分类：
  - `scout_http_error`
  - `scout_timeout`
  - `scout_contract_error`
  - `skill_output_encoding_error`
  - `skill_serialization_error`

这样即使未来 Scout 再有 contract 轻微变动，crawler skill 仍能保持兼容和可诊断性。

### Layer 3: Desktop runtime Python environment hardening

桌面 runtime 需要把 Python skill 的 I/O 编码从“依赖本机环境”收敛为“宿主统一约束”。

建议为所有 Python local skill 默认注入：

- `PYTHONIOENCODING=utf-8`
- `PYTHONUTF8=1`

这不应只给 `official.skills.crawler` 特判，而应作为 Python local skill 的默认宿主策略。因为今天暴露在 crawler 上，明天也可能在别的官方 skill 上复现。

此外，需要为 skill 执行错误增加编码类识别，让桌面端日志和错误块能清楚区分：

- 上游抓取失败
- skill contract 失败
- 本地输出编码失败

## Compatibility strategy

### Scout compatibility

- 保留现有 `markdown` 与 `metadata` 字段
- 追加稳定的 top-level `title`
- `metadata.normalization` 为新增字段，不破坏旧消费方

### Crawler compatibility

- 继续返回 `status/title/markdown/content/metadata/url`
- `content` 继续作为 `markdown` 的兼容镜像
- 仅增强编码与 contract fallback，不改变工具名和入参

### Desktop compatibility

- 不改变 `web.fetch` 能力名
- 不改变 `provider_doc_ingestion` 调用方式
- 将 Python UTF-8 env 注入作为宿主默认能力增强

## Testing strategy

### Scout tests

- 文本规范化函数单测：
  - 含 `U+200B`
  - 含 BOM
  - 混合 `\r\n`
- API 测试：
  - `title` 出现在顶层
  - `metadata.normalization` 正确反映处理结果

### Crawler skill tests

- 单测 `handle_input()` / emitter：
  - 正常 UTF-8 内容可输出
  - 含零宽字符内容可输出
  - Scout contract 缺 `title` 时可 fallback
- 集成测试：
  - 模拟 Scout 成功返回含 `U+200B` 的 markdown，不再触发输出错误

### Desktop runtime tests

- `resolve_skill_binding_env` 或等价 runtime 构造测试确认 Python env 包含 UTF-8 约束
- 执行测试确认编码类错误能被结构化识别

## Rollout order

1. 先在 `Scout` 引入规范化与顶层 `title` contract
2. 再升级 `official.skills.crawler` 的 JSON emitter 和 contract adapter
3. 最后在 `desktop runtime` 注入统一 Python UTF-8 env
4. 跑三层测试与一条端到端回归链路

## Recommendation

推荐一次性完成三层收敛，不做单点补丁：

- 只修 crawler，会留下 Scout contract 漂移与宿主 locale 依赖
- 只修 Scout，会留下 Python stdout 环境不稳定
- 只修 runtime，会留下 title 丢失和文本清洗缺位

这条链是桌面本地高频能力基础设施，值得按“内容 contract + transport adapter + host runtime policy”三层一起做成稳定生产方案。

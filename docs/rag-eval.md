# Deeting RAG Eval Harness

> 适用范围:用客观指标衡量 Deeting 桌面端 RAG 检索质量的可重跑评测层。
> 不覆盖:答案质量评估(citation accuracy / answer faithfulness),那需要 LLM-as-judge,留待后续。

本文档是 [`modules/rag_eval`](../deeting/src-tauri/src/modules/rag_eval/) 的"权威说明书"。目标是让任何一次 RAG 改动(改 BM25 权重、加 reranker、换 chunking 策略、加 query rewriting)都能用同一套数字判定**到底改好了还是改坏了**,而不是凭感觉拍脑袋。

- 这个模块为什么存在
- API 长什么样
- Golden Set 怎么写
- Runner 怎么搭
- 指标怎么读
- 在哪里加东西

## 1. TL;DR

```rust
use deeting::modules::rag_eval::{run_eval, EvalCase, RetrievedItem};

// 1. 加载 golden set(项目里手写的小型测试集)
let cases: Vec<EvalCase> = serde_json::from_str(&std::fs::read_to_string("golden_set.json")?)?;

// 2. 跑 eval —— 给 harness 一个闭包,让它知道怎么调你的检索器
let report = run_eval(&cases, &[1, 3, 5, 10], |case| async {
    your_retriever(&case.query).await
}).await;

// 3. 看数字
println!("recall@5 = {:.3}", report.recall_at_k.iter().find(|m| m.k == 5).unwrap().value);
println!("MRR = {:.3}", report.mrr);

// 4. 存档,下次改 RAG 之后 diff 这份报告
std::fs::write("report.json", serde_json::to_string_pretty(&report)?)?;
```

核心思想:**harness 只评检索层,不依赖 LLM,纯函数+确定性,跑 100 次结果一样**。

## 2. 为什么这么做

旧做法的问题:

1. **凭感觉迭代**:改了 BM25 权重觉得"答得更准了",其实只在改的那两个 query 上看着好,其他 query 可能悄悄变差。
2. **回归无感**:几个月后有人换个 chunking,recall 下降 15% 没人发现,直到客户投诉。
3. **优化方向无据**:"要不要加 reranker?要不要做 fanout?"这些决策没有数字支撑,变成口水仗。

新做法:

| 旧 | 新 |
|---|---|
| 改完 RAG 跑几个手测 query | 跑 50-200 题 golden set,出客观数字 |
| "比上次好" | recall@5 从 0.62 升到 0.78 |
| 看不到回归 | report.json diff 立刻暴露哪几题崩了 |
| 决策靠经验 | 决策靠 A/B 数字 |

## 3. 架构总览

```text
┌──────────────────────────────────────────────────────────┐
│  Caller (test / binary / CI job)                         │
│                                                          │
│    ┌─────────────────┐         ┌────────────────────┐   │
│    │ golden_set.json │ ──load──┤ Vec<EvalCase>      │   │
│    └─────────────────┘         └────────────────────┘   │
│                                       │                  │
│                                       ▼                  │
│    ┌────────────────────────────────────────────────┐   │
│    │ run_eval(cases, k_values, retriever_fn).await  │   │
│    └────────────────────────────────────────────────┘   │
│                          │                               │
│         ┌────────────────┼────────────────┐              │
│         ▼                ▼                ▼              │
│   evaluate_case(c1)  evaluate_case(c2)  ...              │
│         │                                                │
│         ▼                                                │
│   aggregate(case_results, k_values) → EvalReport         │
│                          │                               │
│                          ▼                               │
│                  ┌───────────────┐                       │
│                  │  report.json  │  ←── 存档 / diff      │
│                  └───────────────┘                       │
└──────────────────────────────────────────────────────────┘
```

**模块边界**:harness 是纯逻辑库,**不依赖 AppState、不依赖数据库、不依赖任何具体源**。`retriever_fn` 闭包是接口边界——caller 负责把 `EvalCase.query` 喂给真实的检索器(knowledge / llm_wiki / memory / multi-query fanout / 等等),拿回 `Vec<RetrievedItem>` 给 harness 算分。

这意味着同一套指标可以:

- 评 [`knowledge.store.search_local_knowledge_chunks`](../deeting/src-tauri/src/modules/knowledge/store.rs) 单源
- 评 [`search_local_llm_wiki_corpus`](../deeting/src-tauri/src/modules/llm_wiki/service.rs) 单源
- 评 `context_search` 的 auto 模式(三源并发)
- 对比"加 query rewriting 前 vs 后"
- 对比"用 chunk_size=400 vs 800"
- 对比"BM25 字段权重 1.0/0.8/0.6 vs 3.0/1.5/0.6"

## 4. 模块树

```
deeting/src-tauri/src/modules/rag_eval/
├── mod.rs        // 全部公开 API:类型 + 三个函数
└── tests.rs      // 单元测试(9 个,覆盖度量数学和边界情况)
```

注册位置:[`modules/mod.rs`](../deeting/src-tauri/src/modules/mod.rs) 中的 `pub mod rag_eval;`

## 5. API 详解

### 5.1 输入类型

```rust
pub struct EvalCase {
    pub id: String,                         // 唯一 ID,便于在 report 里定位
    pub query: String,                      // 要检索的问题(用户原话或改写后)
    pub expected_chunk_ids: Vec<String>,    // 期望命中的 chunk ID 列表(any-hit 语义)
    pub expected_source: Option<String>,    // 可选:期望命中哪个源
    pub notes: Option<String>,              // 可选:人类标注备注,便于复盘
}

pub struct RetrievedItem {
    pub chunk_id: String,                   // 必须跟 expected_chunk_ids 中的格式一致
    pub source: String,                     // "knowledge" / "llm_wiki" / "memory"
    pub score: f64,                         // 源原生分数(harness 不用它打分,只用排序)
}
```

**Any-hit 语义**:`expected_chunk_ids` 列多个,只要 top-k 里命中**任意一个**就算通过。这是 RAG 评测的标准做法——多数问题有 1-3 段都能支撑答案,只要召回任一段都行。

**chunk_id 格式**:必须跟 retriever 返回的 `chunk_id` 字面相等。建议用 `{file_id}:{chunk_index}` 格式(跟 [`knowledge_locator_id`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) 对齐),这样 golden set 写起来也容易。

### 5.2 输出类型

```rust
pub struct CaseResult {
    pub case_id: String,
    pub retrieved_count: usize,             // 这次 retriever 返回了几条
    pub first_hit_rank: Option<usize>,      // 第一条命中的排名(1-based);None = 一条都没命中
    pub hit_at_k: Vec<KMetric>,             // {k: 1, value: 1.0/0.0},每个 k 值一条
}

pub struct EvalReport {
    pub case_count: usize,
    pub recall_at_k: Vec<KMetric>,          // 所有 case 的平均 recall@k
    pub mrr: f64,                           // 平均倒数排名
    pub cases: Vec<CaseResult>,             // 每题详情,便于 diff
}
```

### 5.3 公开函数

```rust
// 评单题
pub fn evaluate_case(
    case: &EvalCase,
    retrieved: &[RetrievedItem],
    k_values: &[usize],
) -> CaseResult;

// 把单题结果聚合成报告
pub fn aggregate(cases: Vec<CaseResult>, k_values: &[usize]) -> EvalReport;

// 一站式:接收 cases 和 retriever 闭包,跑完返回报告
pub async fn run_eval<F, Fut>(
    cases: &[EvalCase],
    k_values: &[usize],
    retriever: F,
) -> EvalReport
where
    F: FnMut(&EvalCase) -> Fut,
    Fut: Future<Output = Vec<RetrievedItem>>;
```

90% 的情况用 `run_eval` 就够了。`evaluate_case` / `aggregate` 是给特殊用法暴露的(例如想分两批跑,或想自己实现并发调度)。

## 6. Golden Set 怎么写

### 6.1 基本格式

```json
[
  {
    "id": "q_001_vector_db",
    "query": "项目里用什么向量数据库?",
    "expected_chunk_ids": ["file-arch-1:3", "file-arch-1:4"],
    "expected_source": "knowledge",
    "notes": "core architecture / storage choice"
  },
  {
    "id": "q_002_auth_flow",
    "query": "登录流程是怎么走的",
    "expected_chunk_ids": ["file-auth:0", "file-auth:1", "file-auth:7"],
    "expected_source": "knowledge",
    "notes": "any of these chunks covers the OAuth flow"
  }
]
```

### 6.2 怎么挑题

**起步规模:50-100 题**。少了样本太小、信噪比差;多了维护成本爆炸。从这些维度采样:

| 维度 | 例题 |
|---|---|
| 短关键词 query | "向量数据库" |
| 长自然语言 query | "我们这边检索是用哪个数据库做的存储?" |
| 含代词 / 上下文 | "它的性能怎么样?"(测查 query rewriting) |
| 多意图 | "对比新老 auth,哪个更好" |
| 应该零命中 | "做核武器" → expected_chunk_ids = [](测查 abstain) |
| 多源混合 | "用户偏好"(应该 hit memory 而不是 knowledge) |
| 边界 / trivia | "项目作者是谁"(冷门事实,容易漏召) |

### 6.3 怎么标 expected_chunk_ids

1. 跑当前 RAG,看 top-10 命中
2. 人工挑出"如果模型用这条 chunk 答,答案是对的"的那几条 → 进 expected
3. 容忍多个正确答案:多写几个 chunk_id 用 any-hit
4. **不要回标自己已知的命中 ID** —— 这会变成"测当前实现 vs 当前实现",永远 100%。要从"用户问题视角"判断"哪几段内容能支撑正确答案",而不是"当前实现召回了哪几段"。

### 6.4 维护节奏

- 知识库内容大变(导入大批新文档)→ 重新审一遍 expected_chunk_ids 是否还有效
- 新增功能(加 reranker、加 fanout)→ 不动 golden set,只看数字变化
- 每月扫一次,把"现在看 expected 不准了"的题修掉或删掉

## 7. Runner 怎么搭

harness 本身不提供 runner —— 因为 runner 需要拿到 `AppState`,而怎么 boot AppState 跟你们的项目结构强相关。这里给一个**示例**(放在哪都行,推荐 `tests/rag_eval.rs` 或一个 `examples/eval_runner.rs`):

```rust
use deeting::modules::rag_eval::{run_eval, EvalCase, RetrievedItem};

#[tokio::test]
#[ignore]  // 标 ignore 避免 CI 每次跑;手动: cargo test rag_eval_smoke -- --ignored
async fn rag_eval_smoke() {
    let cases: Vec<EvalCase> = serde_json::from_str(
        &std::fs::read_to_string("tests/rag_eval/golden_set.json").unwrap()
    ).unwrap();

    let app_state = /* boot minimal AppState — 用你们项目里测试 fixture 的标准方式 */;

    let report = run_eval(&cases, &[1, 3, 5, 10], |case| {
        let q = case.query.clone();
        let store = app_state.knowledge.store.clone();
        async move {
            store
                .search_local_knowledge_chunks(&q, Some(10))
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|hit| RetrievedItem {
                    chunk_id: format!("{}:{}", hit.file_id, hit.index),
                    source: "knowledge".into(),
                    score: hit.score,
                })
                .collect()
        }
    })
    .await;

    let report_path = "tests/rag_eval/last_report.json";
    std::fs::write(report_path, serde_json::to_string_pretty(&report).unwrap()).unwrap();

    let r5 = report
        .recall_at_k
        .iter()
        .find(|m| m.k == 5)
        .map(|m| m.value)
        .unwrap_or(0.0);
    println!("recall@5 = {:.3}, MRR = {:.3}, cases = {}", r5, report.mrr, report.case_count);

    // 可选:设最低阈值,防止悄悄回归
    assert!(r5 >= 0.70, "recall@5 regressed below 0.70: {r5}");
}
```

### 7.1 评 context_search auto 模式(跨源)

```rust
let report = run_eval(&cases, &[1, 5, 10], |case| {
    let app_state = app_state.clone();
    let q = case.query.clone();
    async move {
        // 调你们已有的工具(模拟模型的调用)
        let tool_result = execute_context_tool(
            &app_state,
            "context_search",
            &serde_json::json!({ "query": q, "source": "auto", "limit": 10 }),
            &[],
        ).await.unwrap();

        // 把 auto 返回的 envelopes 摊平成统一的 RetrievedItem 列表
        flatten_auto_envelopes(&tool_result)
    }
}).await;
```

`flatten_auto_envelopes` 是 caller 自己写的辅助函数,把 envelope.items 摊平,统一 chunk_id 格式。harness 完全不关心你怎么摊。

### 7.2 对比实验(A/B)

```rust
let report_a = run_eval(&cases, &[5], retriever_old_chunking).await;
let report_b = run_eval(&cases, &[5], retriever_new_chunking).await;
let recall_a = report_a.recall_at_k.iter().find(|m| m.k == 5).unwrap().value;
let recall_b = report_b.recall_at_k.iter().find(|m| m.k == 5).unwrap().value;
println!("recall@5: {:.3} → {:.3} (Δ {:+.3})", recall_a, recall_b, recall_b - recall_a);
```

这才是 eval harness 的**最终用法**。每次改 RAG 都跑一次,留档,后续优化用这个数字说话。

## 8. 指标怎么读

### 8.1 Recall@k

「top-k 里有没有期望的 chunk?」是 1/0 的二元指标,case 之间求平均得到 recall@k。

| recall@5 | 含义 |
|---|---|
| 0.30 | 30% 的题在前 5 条里能找到证据,RAG 严重欠召回 |
| 0.65 | 一般水平,改 chunking / query rewriting 能拉上去 |
| 0.85 | 很好,接近上限 |
| 0.95+ | 优秀,基本只剩长尾在丢 |

**优先看哪个 k?**

- `recall@10`:看检索引擎天花板。低了说明召回阶段就漏了
- `recall@5`:模型实际能用到的范围。提升这个最直接
- `recall@1`:最难,需要排序质量高(reranker / MMR 在这里见效)
- `recall@3`:常用平衡点

### 8.2 MRR(Mean Reciprocal Rank)

「第一条命中排在第几?」`1/rank`,然后所有 case 求平均。比 recall@k 更敏感于**排序质量**。

| MRR | 含义 |
|---|---|
| 0.20 | 命中通常在第 5 条左右(1/5 = 0.2) |
| 0.50 | 命中通常在第 2 条左右 |
| 0.80 | 命中通常在第 1-2 条,排序很好 |

- 改 chunking → recall@k 提升明显,MRR 略升
- 改 reranker / MMR → MRR 提升明显,recall@k 不一定动
- 改 query rewriting → 两者一起升

### 8.3 怎么组合用

| 现象 | 推断 | 下一步 |
|---|---|---|
| recall@10 低 | 召回引擎不行 | 改 chunking / 加 fanout / 换 embedding |
| recall@10 高但 recall@1 低 | 召回 OK,排序不准 | 加 reranker / MMR |
| MRR 涨但 recall@10 没动 | 改进只影响排序,没扩召回 | 看看是不是过度优化排序 |
| 整体平移 | 全面提升 | 留档,继续下一项 |

## 9. 怎么扩展

### 9.1 加新指标(例:nDCG)

在 `mod.rs::CaseResult` 加字段,在 `evaluate_case` 计算,在 `aggregate` 求平均。**不要在 caller 处算**——harness 是指标库的唯一来源,避免散落实现。

### 9.2 接新源

只要 caller 能把该源的返回映射成 `RetrievedItem { chunk_id, source, score }`,harness 不需要任何改动。

### 9.3 加 LLM-as-judge(答案质量)

**不要往这个 harness 里塞**。它是确定性、纯逻辑、离线的。如果要做答案质量评估,起一个 sibling 模块 `modules/rag_answer_eval/`(或别的名),让两套指标各跑各的。混在一起会让"为什么这次跑不出来"变得很难排查。

## 10. 反模式

PR review 时拒绝以下:

- ❌ 让 harness 直接依赖 `AppState` —— 这会强制每次 eval 都启动完整桌面端
- ❌ 让 harness 调 LLM —— 失去确定性
- ❌ 在 harness 内部硬编码 `knowledge.store` —— 失去多源复用能力
- ❌ 在 `aggregate` 里改 `case` 的 score —— harness 是评测器,不是排序器
- ❌ 在 golden set 里写"当前实现召回到的 chunk" —— 自测自,永远 100%,无意义
- ❌ 把 report.json 提交进 git —— 它是产出物,会跟运行环境耦合;只在本地比对或 CI 上传

## 11. 已知决策

| 决策 | 原因 |
|---|---|
| Any-hit 语义(任一命中即算通过) | 多数 RAG 问题有 1-3 个等价支持段,要求全部命中过严 |
| 不提供 runner,只提供 harness | runner 跟 AppState boot 方式强耦合,放进 harness 反而限制使用场景 |
| 不支持并发 retriever 调用 | 简化语义,RAG eval 通常 case 数 ≤ 200,串行也只要几秒 |
| 不内置 LLM judge | 见 §9.3 |
| `KMetric` 用 `Vec<{k, value}>` 而不是 `HashMap<usize, f64>` | JSON 序列化更稳定(不需要 stringify 数字 key),且保持插入顺序 |

## 12. FAQ

**Q:为什么不让 harness 自己跑 `context_search` 工具?**
A:那样 harness 就绑定了 `context_orchestrator`,无法独立评估单源(例如只评 knowledge 召回质量)。让 caller 决定调什么是更灵活的设计——caller 可以选择"调原始 store"、"调 context_search 单源"、"调 context_search auto 三源"等不同粒度。

**Q:Golden set 要不要分类(比如 entity / concept / how-to)?**
A:可以在 `EvalCase.notes` 里写标签,然后在 caller 处对 `report.cases` 做分组聚合。harness 本身不做分类——把分类逻辑混进度量库会让接口变臃肿。

**Q:Recall@5 应该到多少算合格?**
A:没有绝对值。**只看变化**:同一 golden set,这次改动后 recall 升还是降,升多少。绝对值跟你们知识库本身的难度强相关。

**Q:能不能用这个 harness 评 memory 检索?**
A:能。memory 的 `chunk_id` 用 memory_id 即可,把 `app_state.memory.service.search` 包成 retriever 闭包就行。这是 harness 设计成"接口化"的回报。

**Q:跑出来的 report.json 怎么 diff?**
A:`jq` 比对 `recall_at_k` 和 `mrr` 顶层字段就够看大盘。要看哪几题崩了,diff `cases[*].first_hit_rank` —— 旧的有值新的变 None 就是新的崩了。也可以写个小脚本,导出"回归题列表"。

**Q:能不能把 report 上传到飞书 / Slack?**
A:harness 不管这个。让 CI 跑完 eval 后用任何方式上传。harness 输出标准 JSON,什么都能消费。

## 13. 验证清单

改动 eval harness 本身的 PR 必须自检:

- [ ] `cargo check --tests`
- [ ] `cargo test --lib rag_eval --no-fail-fast`(Windows 环境若 DLL 加载失败,见 [rag-architecture.md §16](./rag-architecture.md))
- [ ] 改 metric 数学的 PR:加单元测试覆盖新边界

加 golden set 题目的 PR 不需要跑 harness,但需要:

- [ ] 题目用 `id` 唯一标识(便于 diff)
- [ ] `expected_chunk_ids` 至少 1 项(或显式标注"应零命中")
- [ ] `notes` 写清楚标这道题的理由

## 14. 参考

- 模块代码:[`modules/rag_eval/`](../deeting/src-tauri/src/modules/rag_eval/)
- 上游架构:[`docs/rag-architecture.md`](./rag-architecture.md)
- 经典论文:Voorhees, E. M. (1999). The TREC-8 question answering track evaluation. — recall@k / MRR 的原始定义
- 实践参考:Lewis et al. (2020). *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*. NeurIPS.

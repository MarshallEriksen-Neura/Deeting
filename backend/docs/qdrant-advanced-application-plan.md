# Qdrant 深度应用扩展规划

本文档基于现有架构（插件记忆、语义缓存、市场发现），规划 Qdrant 在 AI Higress Gateway 中的四个高价值深层应用场景。

## 1. 动态少样本增强 (Dynamic Few-Shot Prompting)

### 痛点
复杂的 Agent 任务（如代码生成、SQL 撰写、复杂逻辑推理）往往需要高质量的示例（Few-Shot）才能稳定输出，但将所有示例硬编码进 System Prompt 会导致上下文超长且灵活性差。

### 解决方案
建立专用的 `kb_fewshot` 集合，存储各垂直领域的优秀 Prompt/Response 对。

### 实施流程
1.  **预制数据**: 存入结构化示例，例如：
    ```json
    {
      "task_type": "python_coding",
      "user_query": "使用 httpx 发送异步请求",
      "assistant_response": "async with httpx.AsyncClient() as client:\n    resp = await client.get('... ')"
    }
    ```
2.  **检索拦截**: 在构建发往 LLM 的消息前，先根据当前用户 Query 检索 Top-N 个最相似的示例。
3.  **动态注入**: 将检索到的示例动态拼接到 System Prompt 的 "Examples" 章节中。
4.  **生成**: LLM 参考上下文中的相似示例，模仿其风格和逻辑进行输出。

### 价值
- **效果提升**: 显著提高特定任务的准确率和代码质量。
- **无需微调**: 通过RAG方式实现类似微调的效果，维护成本极低。

---

## 2. 语义路由与意图识别 (Semantic Routing / Intent Classification)

### 痛点
传统的基于关键词（Regex/Keyword）的路由规则过于死板，无法理解语义；而每条请求都调用 LLM 进行分类又太慢且贵。

### 解决方案
利用向量距离实现“零样本分类器”。在 Qdrant 中预存一组“意图锚点（Intent Anchors）”。

### 实施流程
1.  **定义锚点**:
    - `Intent: Technical_Support` -> 对应标准问题向量（如“系统报错怎么办”）
    - `Intent: Billing_Inquiry` -> 对应标准问题向量（如“充值未到账”）
    - `Intent: Chit_Chat` -> 对应闲聊向量（如“你好”）
2.  **网关决策**:
    - 用户请求进入网关。
    - 计算 Query 向量，计算与各锚点的余弦相似度。
    - 取相似度最高的分类。
3.  **路由分发**:
    - **Billing**: 转发给财务系统/人工客服。
    - **Technical**: 调用技术文档 Agent。
    - **Chit_Chat**: 调用小参数模型（如 GPT-3.5/Haiku）快速回复。

### 价值
- **高性能**: 纯向量计算，毫秒级延迟。
- **低成本**: 减少对昂贵大模型的主调用次数。

---

## 3. 语义防火墙 (Semantic Firewall / Guardrails)

### 痛点
正则匹配难以过滤“隐晦的攻击指令”（Prompt Injection）或“不当言论”。

### 解决方案
建立 `kb_guardrails` 集合，存储已知的攻击模式、敏感话题样本。

### 实施流程
1.  **输入防御 (Input Guard)**:
    - 用户输入后，先在 Qdrant 中检索相似度。
    - 如果与“越狱指令库”相似度 > 0.85，直接拒绝请求，不透传给 LLM。
2.  **输出审查 (Output Guard)**:
    - 模型生成内容后，检索相似度。
    - 防止模型泄露 PII（个人敏感信息）或生成有害内容。

### 价值
- **企业级安全**: 构建非基于规则的动态防御体系。
- **合规性**: 确保输出符合内容安全规范。

---

## 4. 自动化工具推荐 (Just-in-Time Tooling)

### 痛点
随着插件生态发展，系统可能拥有数百个工具。将所有工具的 JSON Schema 放入 System Prompt 会超出 Context Window 限制，且增加幻觉风险。

### 解决方案
利用现有的 `plugin_marketplace` 集合实现“按需加载”。

### 实施流程
1.  **意图检索**: 用户输入 Query（如“帮我画一张赛博朋克的图”）。
2.  **市场搜索**: 后台静默搜索 `plugin_marketplace`，query="draw cyberpunk image"。
3.  **动态挂载**:
    - 检索到 `Midjourney_Plugin` 和 `StableDiffusion_Plugin`。
    - **仅在当前轮次**，将这两个插件的工具定义提取出来，临时注入到 API 请求的 `tools` 参数中。
4.  **模型调用**: LLM 看到相关工具，决定调用其中之一。

### 价值
- **无限能力**: 理论上支持无限数量的工具。
- **节省 Token**: 每次只加载最相关的 3-5 个工具定义。

---

## 5. Spec Knowledge 三层漏斗 (Spec KB Funnel)

### 痛点
Spec/配置模板天然具有高价值，但“生成式输出”并不等于“系统级知识”。缺乏筛选会导致 KB 污染。

### 解决方案
建立 **用户反馈 → 自动化评估 → 管理员审核** 的三层漏斗：

1. **用户反馈**：显式（赞/通过）+ 隐式（应用/部署/复制且无回滚/错误）。
2. **自动化评估**：静态规则（敏感/危险指令）+ LLM 质量评分。
3. **候选区与审核**：进入 `kb_candidates` 暂存，管理员/多次命中后晋升 `kb_system`。

### 数据结构建议
新增 `kb_candidates` 集合，payload 内包含：
- `canonical_hash`：规范化哈希去重
- `usage_stats`：sessions/total_runs/success_rate
- `revert_count`、`eval_snapshot`、`trust_weight`

### 价值
- **质量可控**：避免幻觉进入系统 KB
- **可解释**：每条候选都有评估与来源溯源
- **可进化**：通过命中统计自动晋升优质知识

---

## 建议实施路线图

1.  **Phase 1 (Quick Win)**: 实施 **动态少样本增强**。只需增加一个 Collection 和简单的检索注入逻辑，对开发体验提升明显。
2.  **Phase 2 (Security)**: 实施 **语义防火墙**。作为网关的核心安全特性对外发布。
3.  **Phase 3 (Scalability)**: 当插件数量 > 20 时，实施 **自动化工具推荐**。

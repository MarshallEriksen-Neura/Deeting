# Credits Transaction Dashboard

现代化的积分流水控制台页面，采用 "Crystal Command Center" 设计理念。

## 设计特点

### 1. **Bento Grid 布局**
- 摒弃传统的表格布局，采用卡片式 Bento Grid 设计
- 信息层次清晰，视觉冲击力强
- 响应式设计，支持移动端和桌面端

### 2. **Glassmorphism 设计风格**
- 使用现有的 `GlassCard` 组件保持设计一致性
- 磨砂玻璃效果，配合背景模糊
- 支持深色和浅色主题无缝切换

### 3. **数据可视化**
- **Balance Reactor Card**: 圆环进度条显示剩余积分百分比
- **Consumption Trend Chart**: 30天消费趋势平滑曲线图
- **Model Usage Chart**: 圆环图展示不同模型使用占比

### 4. **Terminal 风格交易流水**
- 无边框设计，类似终端日志
- 手风琴式展开/折叠详情
- 状态指示器（绿点/红叉）
- 等宽字体显示技术数据

## 页面结构

```
/dashboard/credits/
├── page.tsx                              # 主页面
└── components/
    ├── balance-reactor-card.tsx          # 积分余额卡片（带圆环进度）
    ├── membership-plan-card.tsx          # 会员套餐卡片
    ├── model-usage-chart.tsx             # 模型使用饼图
    ├── consumption-trend-chart.tsx       # 消费趋势图表
    ├── quick-actions-card.tsx            # 快速操作面板
    └── transaction-stream.tsx            # 交易流水列表
```

## 组件说明

### Balance Reactor Card (积分反应堆)
- **位置**: 左上角，最显眼位置
- **功能**:
  - 显示可用积分余额
  - 圆环进度条显示使用百分比
  - 快速充值按钮
  - 本月已用/剩余统计

### Membership Plan Card (会员计划)
- **位置**: 中间卡片
- **功能**:
  - 当前会员等级
  - 下次续费日期
  - 本月额度使用进度条
  - 升级套餐入口

### Model Usage Chart (模型使用分布)
- **位置**: 右上角
- **功能**:
  - 圆环图展示不同 AI 模型使用占比
  - 实时显示各模型消耗统计
  - 百分比和具体数值

### Consumption Trend Chart (消费趋势)
- **位置**: 中间大块区域（占 2/3 宽度）
- **功能**:
  - 30 天 Token 消费趋势
  - 多模型对比（GPT-4o, Claude, Gemini）
  - 平滑曲线图 + 渐变填充
  - 悬停显示具体数据

### Quick Actions Card (快速操作)
- **位置**: 右侧面板（占 1/3 宽度）
- **功能**:
  - 导出 CSV 报表
  - 配置用量提醒
  - 计费设置
  - 实时告警显示

### Transaction Stream (交易流水)
- **位置**: 底部全宽
- **功能**:
  - 近期 API 调用记录
  - 状态指示（成功/失败/处理中）
  - 点击展开查看详情（Request ID、耗时、Prompt、Response）
  - 等宽字体显示技术信息

## 技术栈

- **框架**: Next.js 16 + React 19 + TypeScript
- **样式**: Tailwind CSS 4
- **UI 组件**:
  - GlassCard (自定义玻璃态卡片)
  - Radix UI (无障碍基础组件)
- **图表**: Recharts
- **动画**: Framer Motion
- **图标**: Lucide React
- **国际化**: next-intl

## 国际化支持

- 英文: `messages/en/credits.json`
- 中文: `messages/zh-CN/credits.json`

## 主题支持

页面完全支持深色/浅色主题切换，通过 CSS 变量实现：

- `--foreground`: 主文字颜色
- `--background`: 背景色
- `--card`: 卡片背景色
- `--primary`: 主题色
- `--muted`: 次要文字颜色
- `--teal-accent`: 青色强调色

## 访问路径

```
/dashboard/credits
```

已自动添加到侧边栏导航的 "Configuration" 分组中。

## 数据接口 (待实现)

目前使用 Mock 数据，实际使用时需要对接以下 API：

1. **余额查询**: `GET /api/credits/balance`
2. **会员信息**: `GET /api/credits/membership`
3. **消费趋势**: `GET /api/credits/consumption?days=30`
4. **交易记录**: `GET /api/credits/transactions?limit=20`
5. **充值接口**: `POST /api/credits/recharge`

## 性能优化

- 图表数据通过 `useMemo` 缓存
- 交易列表使用虚拟滚动（可选）
- 图片和图标懒加载
- 响应式图表自适应容器大小

## 开发建议

1. 替换 Mock 数据为真实 API 调用
2. 添加 Loading 状态
3. 添加错误处理和重试逻辑
4. 实现充值功能的支付集成
5. 添加实时数据刷新（WebSocket 或轮询）
6. 添加数据导出功能（CSV/Excel）
7. 实现用量告警配置功能

## 设计灵感

设计参考了现代 SaaS 产品的 Dashboard 设计趋势：

- **去边框化**: 减少视觉噪音
- **数据可视化优先**: 图表比表格更直观
- **玻璃态美学**: 磨砂玻璃+背景模糊
- **极简主义**: 只保留关键信息
- **Terminal 风格**: 技术感与专业性

## 后续扩展

- [ ] 添加积分包充值页面
- [ ] 实现自动充值配置
- [ ] 添加消费预测功能
- [ ] 支持账单下载
- [ ] 添加消费分析报告
- [ ] 实现消费提醒通知

# Settings 页面组件结构

## 重构概述

按照 Next.js 和 React 最佳实践，将原来的单一大组件 `settings-page-client.tsx` 重构为多个小组件，并使用 Glass UI 组件库提供更好的视觉效果。

## 文件结构

```
app/[locale]/settings/
├── page.tsx                          # 服务端组件，负责页面骨架
├── types.ts                          # 共享类型定义
└── components/
    ├── settings-client.tsx           # 主客户端组件
    ├── settings-header.tsx           # 页面头部组件
    ├── settings-alerts.tsx           # 提示信息组件
    ├── settings-form.tsx             # 表单容器组件
    ├── settings-form-actions.tsx     # 表单操作按钮组件
    ├── cloud-settings-card.tsx       # 云端设置卡片
    ├── desktop-settings-card.tsx     # 桌面设置卡片
    └── personal-settings-card.tsx    # 个人设置卡片
```

## 组件职责

### `page.tsx` (服务端组件)
- 负责页面骨架和国际化设置
- 不包含任何客户端逻辑

### `settings-client.tsx` (主客户端组件)
- 整合所有子组件
- 处理用户认证状态
- 管理页面布局

### `settings-form.tsx` (表单容器)
- 管理表单状态和数据获取
- 处理表单提交逻辑
- 协调各个设置卡片

### 设置卡片组件
- `cloud-settings-card.tsx`: 云端嵌入模型设置
- `desktop-settings-card.tsx`: 桌面端设置
- `personal-settings-card.tsx`: 个人助手设置

### 辅助组件
- `settings-header.tsx`: 页面标题和环境信息
- `settings-alerts.tsx`: 认证提示和一致性警告
- `settings-form-actions.tsx`: 表单操作按钮

## UI 组件升级

### Glass UI 组件使用
- **GlassCard**: 替代原生 Card 组件，提供 iOS 风格的磨砂玻璃效果
  - `blur="default"`: 默认模糊强度
  - `theme="surface"`: 表面主题
  - `hover="lift"`: 悬停时的浮动效果
  - `padding="lg"`: 大号内边距

- **GlassButton**: 替代原生 Button 组件，提供玻璃质感按钮
  - `variant="default"`: 主要按钮样式（渐变玻璃效果）
  - `variant="secondary"`: 次要按钮样式（磨砂玻璃）
  - `loading={true}`: 内置加载状态支持

### 视觉效果特性
- iOS 风格的磨砂玻璃质感
- 按压时的物理反馈效果 (scale + 阴影变化)
- 柔和的色彩过渡和微妙的边框
- 悬停时的浮动和光影效果

## 优势

1. **组件职责单一**: 每个组件只负责特定功能
2. **易于维护**: 修改某个功能区域只需要修改对应组件
3. **可复用性**: 各个卡片组件可以在其他页面复用
4. **类型安全**: 共享类型定义确保类型一致性
5. **性能优化**: 组件拆分有利于 React 的渲染优化
6. **符合最佳实践**: 遵循 Next.js App Router 的服务端/客户端组件分离原则
7. **视觉一致性**: 使用 Glass UI 组件库确保整体设计风格统一
8. **用户体验**: iOS 风格的交互效果提供更好的用户体验
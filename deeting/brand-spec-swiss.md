# Deeting Swiss IA · Brand Spec
> 目标流派：瑞士平面 (Information Architecture)
> 灵感来源：Linear, Vercel, Apple Technical Documentation

## 🎨 核心视觉语言

### 调色板 (Grayscale Matrix)
- **Base Bg:** `#f7f7f8` (Light) / `#0a0a0a` (Dark)
- **Panel Bg:** `#ffffff` (Light) / `#111111` (Dark)
- **Hairline:** `rgba(15, 17, 28, 0.08)` (Light) / `rgba(255, 255, 255, 0.08)` (Dark)
- **Accent:** `#6d5cff` (Deeting Primary Blue)
- **Status Online:** `#22c55e` (Emerald-500)
- **Status Off:** `#94a3b8` (Slate-400)

### 排版 (Precision Typography)
- **Font:** `AlibabaPuHuiTi`, `-apple-system`, `Inter`
- **Title:** 20px - 24px, `font-semibold`, `tracking-tight`
- **Label:** 12px, `font-medium`, `text-muted-foreground`, `uppercase`, `tracking-wider`
- **Data:** 13px, `font-mono` (可选，用于 ID 或数值)

### 构图原则 (Structural Grid)
- **No Shadows:** 严禁使用明显的盒子阴影，改用 Hairline 边框。
- **Alignment:** 严格的左对齐，垂直方向上的节奏通过 `4px` 的倍数控制。
- **Micro-interactions:** 按钮 Hover 时仅进行轻微的背景色改变或文字加深。

## 🎯 业务组件定义

### 巡猎任务灯 (Monitor LED)
- 状态灯直径 6px，带 2px 的外部模糊（营造物理灯管感）。

### 渠道磁贴 (Channel Tile)
- 去掉大圆角，改为 `var(--radius)` 或 8px。
- 侧重于显示「最后心跳时间」和「连接健康度」。

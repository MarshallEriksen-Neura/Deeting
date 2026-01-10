# 主题系统统一管理

## 概述

所有主题相关的玻璃拟态效果都通过 `frontend/app/globals.css` 统一管理，确保一致性和易维护性。

## 玻璃拟态 CSS 类

### Card 组件

#### `.neon-glass-card`
霓虹灯卡片的玻璃拟态效果

```css
/* 默认主题 */
.neon-glass-card {
  backdrop-filter: blur(16px) saturate(150%);
  background: rgba(255, 255, 255, 0.12);
}

/* 暗色主题 */
.dark .neon-glass-card {
  background: rgba(0, 0, 0, 0.3);
}

/* 圣诞主题 */
.christmas .neon-glass-card {
  background: rgba(255, 255, 255, 0.15);
}
```

**使用组件**: `NeonCard`

#### `.theme-glass-card`
主题感知卡片的玻璃拟态效果

```css
/* 默认主题 */
.theme-glass-card {
  backdrop-filter: blur(12px);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* 暗色主题 */
.dark .theme-glass-card {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 圣诞主题 */
.christmas .theme-glass-card {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(220, 38, 38, 0.2);
}
```

**使用组件**: `ThemeCard`

### Sidebar 组件

#### `.neon-glass-sidebar`
霓虹灯侧边栏的玻璃拟态效果

**注意**: 由于 shadcn Sidebar 的 DOM 结构，玻璃拟态效果应用到内部的 `[data-slot="sidebar-inner"]` 元素上。

```css
/* 默认主题 */
.neon-glass-sidebar [data-slot="sidebar-inner"] {
  backdrop-filter: blur(16px) saturate(150%);
  background: rgba(255, 255, 255, 0.08) !important;
}

/* 暗色主题 */
.dark .neon-glass-sidebar [data-slot="sidebar-inner"] {
  background: rgba(0, 0, 0, 0.3) !important;
}

/* 圣诞主题 */
.christmas .neon-glass-sidebar [data-slot="sidebar-inner"] {
  background: rgba(255, 255, 255, 0.08) !important;
}
```

**使用组件**: `NeonSidebar`

#### `.theme-glass-sidebar`
主题感知侧边栏的玻璃拟态效果

**注意**: 由于 shadcn Sidebar 的 DOM 结构，玻璃拟态效果应用到内部的 `[data-slot="sidebar-inner"]` 元素上。

```css
/* 默认主题 */
.theme-glass-sidebar [data-slot="sidebar-inner"] {
  backdrop-filter: blur(16px) saturate(150%);
  background: rgba(255, 255, 255, 0.05) !important;
}

/* 暗色主题 */
.dark .theme-glass-sidebar [data-slot="sidebar-inner"] {
  background: rgba(0, 0, 0, 0.3) !important;
}

/* 圣诞主题 */
.christmas .theme-glass-sidebar [data-slot="sidebar-inner"] {
  background: rgba(255, 255, 255, 0.08) !important;
}
```

**使用组件**: `ThemeSidebar`

### Dialog 组件

**注意**: Dialog 组件直接使用 shadcn 原生组件 `@/components/ui/dialog`，会自动跟随 `global.css` 中的主题变量（`--background`, `--foreground`, `--border` 等）变化，无需额外封装。

如果需要特殊的玻璃拟态效果，可以在使用时添加自定义 className：

```tsx
import { Dialog, DialogContent } from "@/components/ui/dialog";

// 普通使用 - 自动跟随主题
<Dialog>
  <DialogContent>
    {/* 内容 */}
  </DialogContent>
</Dialog>

// 需要玻璃拟态效果时
<Dialog>
  <DialogContent className="glass-card">
    {/* 内容 */}
  </DialogContent>
</Dialog>
```

## 优势

### 1. 统一管理
所有玻璃拟态效果在一个文件中管理，修改方便

### 2. 主题自适应
自动根据 `.dark` 和 `.christmas` 类切换样式

### 3. 易于维护
- 修改玻璃拟态效果只需编辑 CSS
- 无需修改组件代码
- 所有使用该类的组件自动更新

### 4. 性能优化
- CSS 类比内联样式性能更好
- 浏览器可以更好地优化和缓存

### 5. 可复用
其他新组件也可以直接使用这些 CSS 类

## 如何自定义

### 调整特定主题的效果

在 `frontend/app/globals.css` 中修改对应的 CSS 类：

```css
/* 例如：让圣诞主题的霓虹卡片更透明 */
.christmas .neon-glass-card {
  background: rgba(255, 255, 255, 0.08); /* 降低不透明度 */
  backdrop-filter: blur(20px); /* 增加模糊 */
}

/* 让暗色主题的侧边栏更暗 */
.dark .neon-glass-sidebar {
  background: rgba(0, 0, 0, 0.5); /* 增加不透明度 */
}
```

### 添加新主题

如果要添加新主题（如 `ocean`、`spring`），只需在 `globals.css` 中添加对应的规则：

```css
/* 海洋主题 */
.ocean .neon-glass-card {
  background: rgba(100, 200, 255, 0.15);
  backdrop-filter: blur(16px) saturate(150%);
}

.ocean .theme-glass-sidebar {
  background: rgba(100, 200, 255, 0.1);
}
```

### 创建新的玻璃拟态组件

如果要创建新的玻璃拟态组件，遵循命名规范：

1. 在 `globals.css` 中定义 CSS 类：
```css
.neon-glass-[component-name] {
  backdrop-filter: blur(16px) saturate(150%);
  background: rgba(255, 255, 255, 0.12);
}

.dark .neon-glass-[component-name] {
  background: rgba(0, 0, 0, 0.3);
}

.christmas .neon-glass-[component-name] {
  background: rgba(255, 255, 255, 0.15);
}
```

2. 在组件中使用：
```tsx
<Component className="neon-glass-[component-name]">
  {children}
</Component>
```

## 组件映射表

| 组件类型 | 霓虹灯版本 | 主题感知版本 | 自适应版本 |
|---------|-----------|------------|-----------|
| Card | `NeonCard` (`.neon-glass-card`) | `ThemeCard` (`.theme-glass-card`) | `AdaptiveCard` |
| Sidebar | `NeonSidebar` (`.neon-glass-sidebar`) | `ThemeSidebar` (`.theme-glass-sidebar`) | `AdaptiveSidebar` |
| Dialog | `NeonDialog` (`.neon-glass-dialog`) | `ThemeDialog` (`.theme-glass-dialog`) | `AdaptiveDialog` |

## 相关文件

- **CSS 定义**: `frontend/app/globals.css`
- **Card 组件**: `frontend/components/cards/`
- **Sidebar 组件**: `frontend/components/sidebars/`
- **Dialog 组件**: `frontend/components/dialogs/`
- **组件文档**: 
  - `frontend/components/cards/README.md`
  - `frontend/components/sidebars/README.md`
  - `frontend/components/dialogs/README.md`

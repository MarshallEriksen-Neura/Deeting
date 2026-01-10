# Sidebar 组件

## AdaptiveSidebar - 自适应主题侧边栏

唯一的通用侧边栏组件，通过 CSS 变量和类名自动适配所有主题。

### 特性

- ✅ **自动主题适配**：通过 CSS 变量自动切换颜色
- ✅ **装饰可拔插**：圣诞装饰等效果通过 CSS 类控制
- ✅ **无需封装**：所有主题共用一个组件
- ✅ **易于扩展**：添加新主题只需修改 CSS

### 使用方式

```tsx
import { AdaptiveSidebar } from "@/components/sidebars/adaptive-sidebar";

export default function Layout({ children }) {
  return (
    <div className="flex h-screen">
      <AdaptiveSidebar />
      <main>{children}</main>
    </div>
  );
}
```

### 主题配置

所有主题样式在 `app/globals.css` 中配置：

```css
/* 默认主题 */
:root {
  --sidebar: #f8fafc;
  --sidebar-foreground: #0f172a;
  /* ... */
}

/* 暗色主题 */
.dark {
  --sidebar: #09090b;
  --sidebar-foreground: #fafafa;
  /* ... */
}

/* 圣诞主题 */
.christmas {
  --sidebar: #fef2f2;
  --sidebar-foreground: #1a0505;
  /* ... */
}
```

### 添加新主题

只需在 `globals.css` 中添加新主题的 CSS 规则：

```css
/* 新主题 */
.ocean {
  --sidebar: #e0f2fe;
  --sidebar-foreground: #0c4a6e;
  /* ... */
}

/* 新主题的玻璃拟态效果 */
.ocean .theme-adaptive-sidebar [data-slot="sidebar-inner"] {
  background: rgba(224, 242, 254, 0.1) !important;
}

/* 新主题的装饰（可选） */
.ocean-decor {
  display: none;
}

.ocean .ocean-decor {
  display: block;
}
```

### 装饰系统

装饰通过 CSS 类控制显示/隐藏：

- `.christmas-menu-decor`：圣诞菜单装饰
- `.christmas-sidebar-decor`：圣诞侧边栏装饰

只在对应主题下显示：

```css
.christmas-menu-decor {
  display: none;
}

.christmas .christmas-menu-decor {
  display: block;
}
```

### 优势

1. **代码简洁**：只有一个组件文件
2. **易于维护**：主题配置集中在 CSS
3. **性能优秀**：无需 JS 判断主题
4. **扩展性强**：添加新主题不需要修改组件代码

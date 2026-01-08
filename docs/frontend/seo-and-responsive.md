# SEO 优化与响应式布局改进

## 概述

本次更新实现了三个主要功能：
1. **站点地图（Sitemap）** - 自动生成 XML 站点地图供搜索引擎抓取
2. **SEO 支持** - 增强元数据、结构化数据和 Open Graph 标签
3. **响应式优化** - 移动端侧边栏改为抽屉式菜单

## 新增文件

### SEO 相关

1. **`frontend/app/sitemap.ts`**
   - 动态生成站点地图，自动在 `/sitemap.xml` 提供
   - 包含所有公开页面和管理员页面（可配置）
   - 设置了合理的优先级和更新频率

2. **`frontend/app/robots.ts`**
   - 生成 `robots.txt` 文件
   - 控制搜索引擎爬虫访问规则
   - 排除敏感页面（API、系统管理、个人信息等）

3. **`frontend/lib/seo.ts`**
   - SEO 工具函数库
   - `generateMetadata()` - 生成页面元数据
   - `generateJsonLd()` - 生成结构化数据（JSON-LD）
   - `pageSEOConfig` - 预定义的页面 SEO 配置

### 响应式组件

4. **`frontend/components/layout/mobile-sidebar.tsx`**
   - 移动端抽屉式侧边栏
   - 使用 Sheet 组件实现滑出效果
   - 点击链接后自动关闭

5. **`frontend/components/ui/sheet.tsx`**
   - Radix UI Dialog 的 Sheet 变体
   - 支持从四个方向滑出（上下左右）
   - 包含遮罩层和关闭按钮

## 修改文件

### 1. `frontend/app/layout.tsx`

**主要改动：**
- 升级元数据配置，添加完整的 SEO 标签
- 添加 Open Graph 和 Twitter Card 支持
- 添加搜索引擎验证码配置
- 注入结构化数据（JSON-LD）
- 设置响应式 viewport 和主题色

**新增元数据：**
```typescript
- title.template - 页面标题模板
- keywords - 关键词
- openGraph - Open Graph 标签
- twitter - Twitter Card 标签
- robots - 搜索引擎爬虫规则
- verification - 搜索引擎验证
```

### 2. `frontend/components/layout/sidebar-nav.tsx`

**主要改动：**
- 添加 `hidden lg:flex` 类，在移动端隐藏
- 保持桌面端（≥1024px）显示

### 3. `frontend/components/layout/top-nav.tsx`

**主要改动：**
- 添加移动端菜单按钮（Menu 图标）
- 集成 MobileSidebar 组件
- 调整布局为 `justify-between`，左侧显示菜单按钮

### 4. `frontend/app/dashboard/layout.tsx`

**主要改动：**
- 调整主内容区 padding：`p-4 lg:p-6`
- 移动端使用较小的内边距，节省空间

## 使用方法

### 在页面中使用 SEO 配置

```typescript
import { generateMetadata, pageSEOConfig } from '@/lib/seo';

export const metadata = generateMetadata({
  title: pageSEOConfig.overview.title,
  description: pageSEOConfig.overview.description,
  keywords: pageSEOConfig.overview.keywords,
  path: '/dashboard/overview',
});
```

### 添加结构化数据

```typescript
import { generateJsonLd } from '@/lib/seo';

const schema = generateJsonLd('WebPage', {
  name: '页面标题',
  description: '页面描述',
  url: 'https://example.com/page',
});

// 在页面中注入
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
/>
```

## 环境变量配置

在 `.env` 或 `.env.local` 中添加：

```bash
# 站点基础 URL（必需）
NEXT_PUBLIC_BASE_URL=https://ai-higress.example.com

# 搜索引擎验证码（可选）
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=your-google-verification-code
NEXT_PUBLIC_YANDEX_VERIFICATION=your-yandex-verification-code

# 是否在站点地图中包含管理员页面（可选，默认 false）
SITEMAP_INCLUDE_ADMIN=false
```

## 响应式断点

项目使用 Tailwind CSS 默认断点：

- `sm`: 640px
- `md`: 768px
- `lg`: 1024px ← **侧边栏显示/隐藏的断点**
- `xl`: 1280px
- `2xl`: 1536px

**移动端（< 1024px）：**
- 侧边栏隐藏
- 顶部导航显示菜单按钮
- 点击菜单按钮打开抽屉式侧边栏
- 内容区使用较小的内边距（16px）

**桌面端（≥ 1024px）：**
- 侧边栏固定显示
- 菜单按钮隐藏
- 内容区使用标准内边距（24px）

## SEO 检查清单

- [x] 站点地图生成（`/sitemap.xml`）
- [x] Robots.txt 配置（`/robots.txt`）
- [x] 元数据标签（title, description, keywords）
- [x] Open Graph 标签（社交媒体分享）
- [x] Twitter Card 标签
- [x] 结构化数据（JSON-LD）
- [x] 搜索引擎验证码支持
- [x] 响应式 viewport 配置
- [x] 主题色配置（支持深色/浅色模式）
- [x] 多语言支持（zh-CN, en-US）

## 后续优化建议

1. **为每个页面添加专属元数据**
   - 在各个 `page.tsx` 中导出 `metadata`
   - 使用 `generateMetadata()` 函数生成

2. **添加 OG 图片**
   - 创建 `/public/og-image.png`（1200x630px）
   - 为不同页面创建专属 OG 图片

3. **配置搜索引擎验证**
   - 在 Google Search Console 注册站点
   - 在 Yandex Webmaster 注册站点
   - 将验证码添加到环境变量

4. **监控 SEO 表现**
   - 使用 Google Analytics 追踪流量
   - 使用 Google Search Console 监控索引状态
   - 定期检查站点地图是否正常

5. **优化移动端体验**
   - 测试不同屏幕尺寸的显示效果
   - 优化触摸目标大小（至少 44x44px）
   - 确保文字可读性（最小 16px）

## 测试方法

### 测试站点地图
```bash
curl http://localhost:3000/sitemap.xml
```

### 测试 robots.txt
```bash
curl http://localhost:3000/robots.txt
```

### 测试响应式布局
1. 打开浏览器开发者工具
2. 切换到移动设备模拟器
3. 测试不同屏幕尺寸（320px, 768px, 1024px, 1920px）
4. 验证侧边栏在移动端正确隐藏
5. 验证菜单按钮在移动端正确显示
6. 验证抽屉式菜单可以正常打开/关闭

### 测试 SEO 标签
1. 访问任意页面
2. 查看页面源代码（右键 → 查看网页源代码）
3. 检查 `<head>` 中的元数据标签
4. 使用 [Rich Results Test](https://search.google.com/test/rich-results) 测试结构化数据

## 相关文档

- [Next.js Metadata API](https://nextjs.org/docs/app/building-your-application/optimizing/metadata)
- [Next.js Sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [Schema.org](https://schema.org/) - 结构化数据规范
- [Open Graph Protocol](https://ogp.me/) - OG 标签规范

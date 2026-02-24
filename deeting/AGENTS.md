# Deeting (Next.js Frontend)

**Next.js 16 Web Application with Tauri Desktop Support**

## OVERVIEW
TypeScript/React 19 前端应用，基于 Next.js 16，提供 AI Gateway Web UI。支持国际化 (i18n)。

## STRUCTURE
```
deeting/
├── app/[locale]/         # Next.js 国际化路由
├── components/           # React 组件 (Shadcn UI, Radix)
├── lib/                  # 工具库 (api, http, swr)
├── store/                # Zustand 状态管理
├── hooks/                # React Hooks
├── types/                # TypeScript 类型定义
├── messages/             # i18n 翻译 JSON
├── constants/            # 常量定义
└── src-tauri/           # Tauri 桌面应用核心
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| 页面路由 | `app/[locale]/` |
| UI 组件 | `components/ui/`, `components/common/` |
| API 调用 | `lib/api/`, `lib/http/` |
| 状态管理 | `store/` |
| i18n | `messages/zh-CN/`, `messages/en/` |

## CONVENTIONS
- TypeScript 严格模式
- 组件使用 Shadcn UI + Radix UI
- 状态管理使用 Zustand
- 数据获取使用 SWR
- i18n 使用 next-intl

## ANTI-PATTERNS
- 禁止直接使用 `fetch`，统一通过 `lib/api/`
- 禁止在组件内直接操作 DOM

## COMMANDS
```bash
# 开发
npm run dev

# 构建
npm run build

# 测试
npm test
```

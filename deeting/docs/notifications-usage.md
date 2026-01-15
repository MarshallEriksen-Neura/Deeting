# 消息通知UI系统使用指南

## 概述

基于Deeting OS"神经反射系统"设计理念的消息通知UI，包含三层次通知方式：

1. **瞬态通知 (Transient)** - Glass Pill样式的Toast
2. **持久通知 (Persistent)** - Inbox Sheet抽屉式通知中心  
3. **环境光提示 (Ambient)** - 无文字的视觉状态指示

## 快速开始

### 1. 在根布局中集成

```tsx
// app/[locale]/layout.tsx
import { NotificationProvider } from "@/components/contexts/notification-context"
import { NotificationSystem } from "@/components/ui/notification-system"

export default async function LocaleLayout({ children, auth }) {
  return (
    <NextIntlClientProvider>
      <NotificationProvider>
        <Header />
        <div className="pt-24">
          {children}
        </div>
        {auth}
        {/* 全局通知系统 */}
        <NotificationSystem ambientTargetId="input-area" />
      </NotificationProvider>
    </NextIntlClientProvider>
  )
}
```

**注意**: Header组件已经集成了通知铃铛，会自动显示未读数量。
```

### 2. 在组件中使用

```tsx
"use client"

import { useNotifications } from "@/components/contexts/notification-context"
import { useNotifications as useToastNotifications } from "@/components/ui/notifications"

export function MyComponent() {
  // 持久通知和环境光
  const { addNotification, setProcessing } = useNotifications()
  
  // 瞬态通知
  const { success, error, warning, info } = useToastNotifications()

  const handleTask = async () => {
    // 设置环境光状态
    setProcessing(true, "正在生成图片...")
    
    try {
      const result = await generateImage()
      
      // 瞬态通知
      success("图片生成完成", "耗时 3.2s", {
        label: "查看",
        onClick: () => viewImage(result)
      })
      
      // 持久通知
      addNotification({
        type: "success",
        title: "图片生成完毕", 
        description: "已完成图片生成任务，可点击查看结果",
        timestamp: new Date(),
        action: {
          label: "查看",
          onClick: () => viewImage(result)
        }
      })
      
    } catch (err) {
      error("生成失败", err.message)
      addNotification({
        type: "error",
        title: "任务失败",
        description: `图片生成失败：${err.message}`,
        timestamp: new Date()
      })
    } finally {
      setProcessing(false)
    }
  }

  return <button onClick={handleTask}>生成图片</button>
}
```

## API 参考

### useNotifications Hook (混合API)

```tsx
// 注意：持久通知现在由Zustand管理
const {
  // 环境光状态 (Context)
  processingState,     // 处理状态
  setProcessing,       // 设置处理状态
  
  // 持久通知 (Zustand)
  notifications,        // 通知列表
  addNotification,      // 添加通知
  markAsRead,          // 标记为已读
  markAllAsRead,       // 全部标记为已读
  clearNotifications,  // 清空通知
} = useNotifications()

// 或者直接使用Zustand hooks
import { useNotificationActions } from "@/stores/notification-store"

const { addNotification } = useNotificationActions()
```

#### addNotification 参数

```tsx
interface NotificationItem {
  type: "info" | "success" | "warning" | "error"
  title: string
  description: string
  timestamp: Date
  read?: boolean
  action?: {
    label: string
    onClick: () => void
  }
}
```

### useNotifications Hook (瞬态通知)

```tsx
const {
  success,        // 成功通知
  error,          // 错误通知
  warning,        // 警告通知
  info,           // 信息通知
  
  // 预设业务场景
  modelConnected,     // 模型连接成功
  balanceWarning,     // 余额警告
  taskCompleted,      // 任务完成
  taskFailed,         // 任务失败
  connectionError,    // 连接错误
  imageGenerated      // 图片生成完成
} = useNotifications()
```

### 环境光指示器

```tsx
// 独立使用
<AmbientIndicator 
  state="processing"  // idle | processing | success | error | warning
  message="正在处理..."
  targetElement={document.getElementById("target")}
/>

// Hook方式
const {
  state,
  setProcessing,
  setSuccess, 
  setError,
  setWarning,
  setIdle
} = useAmbientIndicator("input-area-id")
```

## 国际化支持

通知系统支持中英文切换，文案文件位置：

- `messages/zh-CN/notifications.json`
- `messages/en/notifications.json`

### 添加新文案

1. 在两个语言文件中添加相同的key
2. 在组件中使用 `useTranslations("notifications")` 获取

```tsx
const t = useTranslations("notifications")
return t("events.modelConnected")
```

## 自定义样式

### Glass Pill 自定义

```tsx
// glass-pill-toaster.tsx 中修改样式
toastOptions={{
  classNames: {
    toast: "custom-styles-here",
    title: "custom-title-styles",
    // ...
  }
}}
```

### NotificationCenter 自定义

```tsx
// notification-center.tsx 中修改
const iconBgMap = {
  success: "custom-success-bg",
  // ...
}
```

## 最佳实践

1. **分层使用**：瞬态通知用于即时反馈，持久通知用于重要记录
2. **避免冗余**：错误和警告会自动同时显示两种通知
3. **合理超时**：成功4s，警告6s，错误8s
4. **环境光配合**：长任务时配合环境光指示器
5. **国际化优先**：所有用户文案都要国际化

## 示例场景

### 场景1：AI 模型切换
```tsx
// 瞬态通知
modelConnected("DeepSeek V3", () => navigate("/chat"))

// 持久通知
addNotification({
  type: "success", 
  title: "模型接入成功",
  description: "系统已自动为你切换到最新的 DeepSeek V3 模型",
  timestamp: new Date(),
  action: { label: "测试对话", onClick: () => navigate("/chat") }
})
```

### 场景2：余额预警
```tsx
// 瞬态通知
balanceWarning("5%", "$2.00", () => navigate("/recharge"))

// 环境光（导航栏闪烁）
setWarning("余额不足")
```

### 场景3：图片生成
```tsx
// 开始处理
setProcessing(true, "AI正在创作...")

// 完成
setProcessing(false)
imageGenerated("3.2s", () => showResult())
```

## Zustand状态管理

### Sheet状态控制

通知中心Sheet现在通过Zustand store管理状态，可以直接在任何组件中控制：

```tsx
import { useNotificationSheet } from "@/stores/notification-store"

const { isOpen, setOpen, toggle } = useNotificationSheet()

// 程序化打开/关闭
setOpen(true)  // 打开通知中心
setOpen(false) // 关闭通知中心
toggle()       // 切换状态
```

### 专用Hooks

```tsx
// Sheet控制
import { useNotificationSheet } from "@/stores/notification-store"

// 通知列表
import { useNotificationsList } from "@/stores/notification-store"

// 未读数量
import { useUnreadCount } from "@/stores/notification-store"

// 通知操作
import { useNotificationActions } from "@/stores/notification-store"
```

### Header铃铛集成

Header中的铃铛已经自动集成：
- 显示未读通知数量
- 点击打开/关闭通知中心
- 红点指示器动画效果

这样的设计让通知系统成为应用的"神经反射系统"，既不打扰用户又能及时传达信息。
# 语音功能组件

本目录包含语音输入和音频播放相关的组件。

## 组件列表

### VoiceInputToolbar

语音输入工具栏组件，提供语音输入功能，包括音频可视化和控制。

**特性：**
- 实时音频波形可视化
- 录音状态指示
- 开始/停止录音控制
- 使用 React.memo 优化性能
- 使用 useCallback 缓存事件处理函数

**使用示例：**

```tsx
import { VoiceInputToolbar } from '@/components/common/voice';

export default function VoicePage() {
  return <VoiceInputToolbar />;
}
```

**性能优化：**
- 组件使用 `React.memo` 包装，避免不必要的重渲染
- 事件处理函数使用 `useCallback` 缓存
- 音频可视化使用 Framer Motion 优化动画性能

### GlobalAudioPlayer

全局音频播放器组件，提供 TTS（文本转语音）播放功能。

**特性：**
- 全局浮动播放器
- 播放/暂停控制
- 进度条显示
- 上一曲/下一曲控制
- 使用 React.memo 优化性能
- 使用 useCallback 缓存事件处理函数

**使用示例：**

```tsx
import { GlobalAudioPlayer } from '@/components/common/voice';

export default function Layout({ children }) {
  return (
    <>
      {children}
      <GlobalAudioPlayer />
    </>
  );
}
```

**API：**

组件会在 window 对象上暴露 `startTTS` 方法（仅用于演示，生产环境建议使用 Context 或 Zustand）：

```tsx
// 触发播放
window.startTTS('要朗读的文本内容');
```

**性能优化：**
- 组件使用 `React.memo` 包装
- 所有事件处理函数使用 `useCallback` 缓存
- 使用 AnimatePresence 优化进入/退出动画

## 国际化

所有组件都使用 `useI18n` Hook 获取多语言文案，支持的 i18n keys：

**VoiceInputToolbar:**
- `chat.voice.listening` - 正在监听状态文案
- `chat.voice.processing` - 处理中状态文案
- `chat.voice.cancel` - 取消按钮文案
- `chat.voice.hint` - 提示文案

**GlobalAudioPlayer:**
- `chat.audio.reading` - 正在朗读文案
- `chat.audio.sampleText` - 示例文本
- `chat.audio.previous` - 上一曲按钮 aria-label
- `chat.audio.play` - 播放按钮 aria-label
- `chat.audio.pause` - 暂停按钮 aria-label
- `chat.audio.next` - 下一曲按钮 aria-label

## 依赖

- `framer-motion` - 动画效果
- `lucide-react` - 图标
- `@/i18n/routing` - 路由国际化
- `@/hooks/use-i18n` - 国际化 Hook

## 迁移说明

这些组件已从 `app/[locale]/chat/components/` 迁移到 `components/common/voice/`。

旧的导入路径仍然可用（通过重导出），但已标记为 deprecated：

```tsx
// ❌ 旧的导入方式（已废弃）
import VoiceInputToolbar from '@/app/[locale]/chat/components/voice-toolbar';
import { GlobalAudioPlayer } from '@/app/[locale]/chat/components/global-audio-player';

// ✅ 新的导入方式（推荐）
import { VoiceInputToolbar, GlobalAudioPlayer } from '@/components/common/voice';
```

## 性能优化总结

1. **React.memo 优化**：两个组件都使用 `React.memo` 包装，避免父组件重渲染时的不必要更新
2. **useCallback 缓存**：所有事件处理函数都使用 `useCallback` 缓存，避免子组件不必要的重渲染
3. **动画优化**：使用 Framer Motion 的优化动画，确保流畅的用户体验
4. **条件渲染**：GlobalAudioPlayer 使用 AnimatePresence 只在需要时渲染

## 未来改进

- [ ] 集成真实的 Web Audio API 替代模拟的音频级别
- [ ] 集成真实的 TTS 服务
- [ ] 使用 Context 或 Zustand 替代 window 对象暴露 API
- [ ] 添加音频录制和上传功能
- [ ] 添加音频格式转换支持
- [ ] 添加音频播放列表功能

'use client';

import { Mic, X, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { useState, useEffect, useCallback, memo } from 'react';
import { useI18n } from '@/hooks/use-i18n';

/**
 * 语音输入工具栏组件
 * 提供语音输入功能，包括音频可视化和控制
 * 
 * @component
 * @example
 * ```tsx
 * <VoiceInputToolbar />
 * ```
 */
const VoiceInputToolbar = memo(() => {
  const [isListening, setIsListening] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const t = useI18n('chat');

  // Simulate audio levels (replace with real Web Audio API)
  useEffect(() => {
    if (!isListening) return;

    const interval = setInterval(() => {
      setAudioLevel(Math.random() * 100);
    }, 100);

    return () => clearInterval(interval);
  }, [isListening]);

  const toggleListening = useCallback(() => {
    setIsListening((prev) => !prev);
  }, []);

  return (
    <div className="relative flex flex-col items-center p-6 min-h-[160px] bg-gradient-to-b from-red-950/20 to-transparent">
      {/* Header */}
      <div className="absolute top-4 right-4">
        <Link href="/chat" scroll={false}>
          <button className="text-white/30 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </Link>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-6 text-sm text-white/70">
        {isListening ? (
          <>
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.8)]" />
            <span>{t("voice.listening")}</span>
          </>
        ) : (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{t("voice.processing")}</span>
          </>
        )}
      </div>

      {/* Waveform visualization */}
      <div className="flex items-center justify-center gap-1 h-24 mb-6">
        {Array.from({ length: 40 }).map((_, i) => {
          const normalizedLevel = isListening
            ? Math.sin((audioLevel + i * 8) / 10) * 50 + 50
            : 10;
          const height = Math.max(4, normalizedLevel);

          return (
            <motion.div
              key={i}
              className="w-1 bg-gradient-to-t from-red-500 via-orange-500 to-yellow-500 rounded-full"
              animate={{
                height: isListening ? height : 4,
                opacity: isListening ? 0.6 + (height / 100) * 0.4 : 0.2,
              }}
              transition={{
                duration: 0.15,
                ease: 'easeOut',
              }}
              style={{
                minHeight: '4px',
              }}
            />
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={toggleListening}
          className={`
            p-6 rounded-full transition-all shadow-2xl
            ${
              isListening
                ? 'bg-red-600 hover:bg-red-500 shadow-red-900/50'
                : 'bg-white/10 hover:bg-white/20'
            }
          `}
        >
          <Mic className="w-8 h-8 text-white" />
        </button>

        <Link href="/chat" scroll={false}>
          <button className="px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-sm text-white transition-colors">
            {t("voice.cancel")}
          </button>
        </Link>
      </div>

      {/* Transcript preview (optional) */}
      <div className="mt-6 max-w-md text-center">
        <p className="text-sm text-white/50 italic">
          {t("voice.hint")}
        </p>
      </div>
    </div>
  );
});

VoiceInputToolbar.displayName = 'VoiceInputToolbar';

export default VoiceInputToolbar;

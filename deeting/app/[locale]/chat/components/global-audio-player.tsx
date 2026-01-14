'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipForward, SkipBack, X, Volume2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface AudioPlayerState {
  isPlaying: boolean;
  text: string;
  progress: number;
  duration: number;
}

export function GlobalAudioPlayer() {
  const [isVisible, setIsVisible] = useState(false);
  const [playerState, setPlayerState] = useState<AudioPlayerState>({
    isPlaying: false,
    text: '',
    progress: 0,
    duration: 100,
  });

  // Simulated demo - in real app, wire to TTS service
  const startPlaying = (text: string) => {
    setPlayerState({
      isPlaying: true,
      text,
      progress: 0,
      duration: 100,
    });
    setIsVisible(true);
  };

  const togglePlay = () => {
    setPlayerState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  const closePlayer = () => {
    setIsVisible(false);
    setPlayerState((prev) => ({ ...prev, isPlaying: false }));
  };

  // Simulate progress (replace with real audio progress)
  useEffect(() => {
    if (!playerState.isPlaying) return;

    const interval = setInterval(() => {
      setPlayerState((prev) => {
        if (prev.progress >= prev.duration) {
          clearInterval(interval);
          return { ...prev, isPlaying: false, progress: prev.duration };
        }
        return { ...prev, progress: prev.progress + 1 };
      });
    }, 100);

    return () => clearInterval(interval);
  }, [playerState.isPlaying]);

  // Expose trigger function globally (use context or zustand in production)
  useEffect(() => {
    // @ts-ignore - attach to window for demo
    window.startTTS = startPlaying;
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-full max-w-2xl px-4"
        >
          <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs text-white/50">
                <Volume2 className="w-3 h-3" />
                <span>正在朗读</span>
              </div>
              <button
                onClick={closePlayer}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Text being read */}
            <div className="mb-3 max-h-16 overflow-hidden">
              <p className="text-sm text-white/70 line-clamp-2">
                {playerState.text ||
                  '关于Web设计的回复：现代网页设计注重用户体验，应该采用简洁的布局...'}
              </p>
            </div>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="relative h-1 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-purple-500 rounded-full"
                  style={{
                    width: `${(playerState.progress / playerState.duration) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-2">
              <button
                className="p-2 text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                aria-label="Previous"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                onClick={togglePlay}
                className="p-3 bg-white text-black rounded-full hover:scale-105 active:scale-95 transition-transform shadow-lg"
                aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
              >
                {playerState.isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current" />
                )}
              </button>

              <button
                className="p-2 text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                aria-label="Next"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

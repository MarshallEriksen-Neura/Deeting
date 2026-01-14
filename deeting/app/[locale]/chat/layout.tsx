import { ReactNode } from 'react';
import { DynamicBackground } from './components/dynamic-background';
// import { GlobalAudioPlayer } from './components/global-audio-player';

export default function ChatLayout({
  children,
  hud,
  canvas,
  controls,
}: {
  children: ReactNode;
  hud: ReactNode;
  canvas: ReactNode;
  controls: ReactNode;
}) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground selection:bg-primary/30">
      {/* Dynamic Animated Background */}
      <DynamicBackground />

      {/* Heads-Up Display (Top Center) */}
      <div className="absolute top-0 left-0 right-0 z-50 flex justify-center pt-6 pointer-events-none">
        <div className="pointer-events-auto">
          {hud}
        </div>
      </div>

      {/* Main Canvas (Full Screen behind UI) */}
      <main className="absolute inset-0 z-10 overflow-hidden">
        {canvas}
      </main>

      {/* Controls / Morphing Bar (Bottom Center) */}
      <div className="absolute bottom-0 left-0 right-0 z-40 flex justify-center pb-8 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-3xl px-4">
          {controls}
        </div>
      </div>

      {/* Children (Modals/Intercepting Routes) */}
      <div className="relative z-[100]">
        {children}
      </div>

      {/* Global TTS Audio Player */}
      {/* <GlobalAudioPlayer /> */}
    </div>
  );
}

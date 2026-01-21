import { ReactNode } from 'react';
import { DynamicBackground } from './components/dynamic-background';
import { WorkspaceShell } from './components/workspace-shell';
// import { GlobalAudioPlayer } from './components/global-audio-player';

export default function ChatLayout({
  children,
  hud,
  canvas,
  controls,
  assistant,
  workspace,
}: {
  children: ReactNode;
  hud: ReactNode;
  canvas: ReactNode;
  controls: ReactNode;
  assistant: ReactNode;
  workspace: ReactNode;
}) {
  return (
    <WorkspaceShell workspace={workspace}>
      <div className="relative h-full w-full overflow-hidden bg-background text-foreground selection:bg-primary/30">
        {/* Dynamic Animated Background */}
        <DynamicBackground />

      {/* Heads-Up Display (Top Center) */}
      <div
        data-chat-hud
        className="absolute top-0 left-0 right-0 z-50 flex justify-center pt-6 pointer-events-none"
      >
        <div className="pointer-events-auto">
          {hud}
        </div>
      </div>

      {/* Main Canvas (Full Screen behind UI) */}
      <main className="absolute inset-0 z-10 overflow-hidden">
        {canvas}
      </main>

      {/* Controls / Morphing Bar (Bottom Center) */}
      <div
        data-chat-controls
        className="absolute bottom-0 left-0 right-0 z-40 flex justify-center pb-8 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-5xl 2xl:max-w-6xl px-4">
          {controls}
        </div>
      </div>

      {/* Children (Modals/Intercepting Routes) */}
      <div className="relative z-[100]">
        {children}
        {assistant}
      </div>

        {/* Global TTS Audio Player */}
        {/* <GlobalAudioPlayer /> */}
      </div>
    </WorkspaceShell>
  );
}

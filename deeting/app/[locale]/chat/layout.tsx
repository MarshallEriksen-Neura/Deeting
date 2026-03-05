import { ReactNode } from 'react';
import DynamicBackground from '@/components/chat/visuals/dynamic-background';
import { ChatAuthGuard } from '@/components/chat/routing/chat-auth-guard';
import { ChatModelConfigGuard } from '@/components/chat/routing/chat-model-config-guard';
import { WorkspaceShell } from '@/components/common/workspace';
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
    <ChatAuthGuard>
      <ChatModelConfigGuard />
      <WorkspaceShell workspace={workspace}>
        <div className="relative h-full w-full overflow-hidden bg-background text-foreground selection:bg-primary/30">
          {/* Dynamic Animated Background */}
          <DynamicBackground />

          {/* Main Canvas (Full Screen behind UI) */}
          <main className="absolute inset-0 z-10 overflow-hidden">
            {canvas}
          </main>

          <div className="relative z-10 grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto]">
            {/* Heads-Up Display (Top Center) */}
            <div
              data-chat-hud
              className="flex justify-center pt-6 pointer-events-none"
            >
              <div className="pointer-events-auto">
                {hud}
              </div>
            </div>

            {/* Chat content */}
            <div
              data-chat-scroll
              className="min-h-0 overflow-y-auto overflow-x-hidden"
            >
              <div className="flex min-h-0 h-full w-full">{children}</div>
            </div>

            {/* Controls / Morphing Bar (Bottom Center) */}
            {controls ? (
              <div
                data-chat-controls
                className="flex justify-center pb-8 pointer-events-none"
              >
                <div className="pointer-events-auto w-full max-w-5xl 2xl:max-w-6xl px-4">
                  {controls}
                </div>
              </div>
            ) : null}
          </div>

          {/* Modals / Assistants overlays */}
          <div className="relative z-[120]">
            {assistant}
          </div>

          {/* Global TTS Audio Player */}
          {/* <GlobalAudioPlayer /> */}
        </div>
      </WorkspaceShell>
    </ChatAuthGuard>
  );
}

import { ReactNode } from 'react';
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import DynamicBackground from '@/components/chat/visuals/dynamic-background';
import { IslandShell } from '@/components/island/island-shell';
import { ChatModelConfigGuard } from '@/components/chat/routing/chat-model-config-guard';
import { ChatTerminalSplitView } from '@/components/chat/core/chat-terminal-split-view';
import { WorkspaceShell } from '@/components/common/workspace';
import { loadStaticLocaleMessages, type StaticMessageNamespace } from "@/i18n/static-messages";
// import { GlobalAudioPlayer } from './components/global-audio-player';

const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"
const CHAT_MESSAGE_NAMESPACES: readonly StaticMessageNamespace[] = [
  "common",
  "chat",
  "knowledge",
  "workflow",
]

export default async function ChatLayout({
  children,
  hud,
  canvas,
  controls,
  assistant,
  workspace,
  params,
}: {
  children: ReactNode;
  hud: ReactNode;
  canvas: ReactNode;
  controls: ReactNode;
  assistant: ReactNode;
  workspace: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const messages = isDesktopExport
    ? await loadStaticLocaleMessages(locale, {
        desktopExport: true,
        namespaces: CHAT_MESSAGE_NAMESPACES,
      })
    : null

  const content = (
    <>
      <ChatModelConfigGuard />
      <WorkspaceShell workspace={workspace}>
        <div className="relative h-full w-full overflow-hidden bg-background text-foreground selection:bg-primary/30">
          {/* Dynamic Animated Background */}
          <DynamicBackground />

          {/* Deeting Island — floating capsule overlay */}
          <IslandShell />

          {/* Main Canvas (Full Screen behind UI) */}
          <main className="absolute inset-0 z-10 overflow-hidden">
            {canvas}
          </main>

          {/* Main interaction layer: chat (left) + terminal panel (right).
              Terminal is collapsed by default; toggled via Island button. */}
          <ChatTerminalSplitView hud={hud} controls={controls}>
            {children}
          </ChatTerminalSplitView>

          {/* Modals / Assistants overlays */}
          <div className="relative z-[120]">
            {assistant}
          </div>

          {/* Global TTS Audio Player */}
          {/* <GlobalAudioPlayer /> */}
        </div>
      </WorkspaceShell>
    </>
  )

  if (!messages) {
    return content
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {content}
    </NextIntlClientProvider>
  );
}

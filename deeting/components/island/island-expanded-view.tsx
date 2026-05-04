"use client";

import {
  ChevronUp,
  Maximize2,
  MessageSquareText,
  Sparkles,
  User,
} from "lucide-react";
import { motion, type Variants } from "framer-motion";

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import type { IslandRecentMessage } from "./island-store";

import { IslandApprovalCard } from "./island-approval-card";
import { resolveIslandStatusLabelKey } from "./island-labels";
import { IslandQuickReply } from "./island-quick-reply";
import { IslandSelectionPanel } from "./island-selection-panel";
import { IslandSeedLogo } from "./island-seed-logo";
import { IslandStatusTimeline } from "./island-status-timeline";
import { useIslandContext } from "./island-context";
import type {
  IslandBrowserLookupHit,
  IslandBrowserLookupPayload,
} from "./browser-lookup-types";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", damping: 20, stiffness: 300 },
  },
};

function findLatestRecentMessage(
  messages: IslandRecentMessage[],
  role: IslandRecentMessage["role"],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return messages[index];
    }
  }
  return null;
}

function IslandUserIntentChip({
  message,
  requestLabel,
}: {
  message: IslandRecentMessage;
  requestLabel: string;
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-[22px] border border-island-gold/30 bg-[linear-gradient(180deg,rgba(245,239,230,0.92),rgba(245,239,230,0.72))] px-3.5 py-2.5 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.25)] dark:bg-[linear-gradient(180deg,rgba(39,31,20,0.92),rgba(31,24,16,0.76))]">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-island-gold/85">
          <User className="h-3 w-3 shrink-0" />
          <span>{requestLabel}</span>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/88">
          {message.content}
        </p>
      </div>
    </div>
  );
}

function IslandAssistantPanel({
  message,
  isActive,
  compact = false,
  responseTitle,
  liveBadge,
  latestBadge,
  emptyText,
  approvalEmptyText,
}: {
  message: IslandRecentMessage | null;
  isActive: boolean;
  compact?: boolean;
  responseTitle: string;
  liveBadge: string;
  latestBadge: string;
  emptyText: string;
  approvalEmptyText: string;
}) {
  return (
    <div className="relative px-4 py-4">
      <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(212,184,150,0.12),transparent_60%)] blur-2xl dark:bg-[radial-gradient(circle_at_center,rgba(212,184,150,0.08),transparent_60%)]" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-island-gold/25 bg-white/65 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.28)] dark:bg-white/8">
            <IslandSeedLogo size={18} isActive={isActive} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/45">
              Deeting
            </div>
            <div className="text-[13px] font-semibold text-foreground/88">
              {responseTitle}
            </div>
          </div>
        </div>
        <div className="rounded-full border border-island-gold/20 bg-white/55 px-2.5 py-1 text-[10px] font-medium text-foreground/55 dark:bg-white/6">
          {isActive ? liveBadge : latestBadge}
        </div>
      </div>

      <div
        className={cn(
          "relative mt-4",
          compact ? "min-h-[160px]" : "min-h-[280px]",
        )}
      >
        {message ? (
          <div className="break-words text-[13px] leading-6 text-foreground/86">
            <MarkdownViewer
              content={message.content}
              className="chat-markdown chat-markdown-assistant text-[13px] leading-6"
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex h-full flex-col items-center justify-center gap-2 text-center",
              compact ? "min-h-[160px]" : "min-h-[280px]",
            )}
          >
            <Sparkles className="h-5 w-5 text-island-gold/75" />
            <p className="max-w-[240px] text-[12px] leading-5 text-foreground/48">
              {compact ? approvalEmptyText : emptyText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function buildBrowserLookupPrompt(
  lookup: IslandBrowserLookupPayload,
  hit: IslandBrowserLookupHit,
) {
  const sourceLabel = hit.source === "wiki" ? "wiki" : "memory"
  return [
    `Please use this local ${sourceLabel} context while helping me understand the current page.`,
    `Source title: ${hit.title}`,
    hit.subtitle ? `Source detail: ${hit.subtitle}` : null,
    `Summary: ${hit.summary}`,
    `Current page: ${lookup.pageContext.title || lookup.pageContext.url}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildAskCurrentPagePrompt(lookup: IslandBrowserLookupPayload) {
  return [
    "Please explain the current page using the attached browser page context.",
    `Current page: ${lookup.pageContext.title || lookup.pageContext.url}`,
    lookup.pageContext.headingsSummary.length > 0
      ? `Visible headings: ${lookup.pageContext.headingsSummary.join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n")
}

function IslandBrowserLookupCard({
  lookup,
  onAttach,
  onDismiss,
  title,
  attachLabel,
  dismissLabel,
}: {
  lookup: IslandBrowserLookupPayload
  onAttach: (lookupId: string, prompt: string) => void
  onDismiss: (lookupId: string) => void
  title: string
  attachLabel: string
  dismissLabel: string
}) {
  const isAskCurrentPage = lookup.kind === "ask_current_page"

  return (
    <div className="rounded-[26px] border border-white/40 bg-white/42 p-3 shadow-[0_18px_42px_-34px_rgba(0,0,0,0.35)] dark:border-white/8 dark:bg-white/4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
            {title}
          </div>
          <div className="mt-1 text-[12px] leading-5 text-foreground/65">
            {lookup.pageContext.title || lookup.pageContext.url}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(lookup.lookupId)}
          className="rounded-full border border-white/40 px-2.5 py-1 text-[11px] text-foreground/55 transition-colors hover:bg-white/55 dark:border-white/10 dark:hover:bg-white/8"
        >
          {dismissLabel}
        </button>
      </div>
      {isAskCurrentPage ? (
        <div className="rounded-[20px] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(245,239,230,0.52))] px-3 py-3 dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(55,45,31,0.78),rgba(24,22,20,0.92))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
                current page
              </div>
              <div className="mt-1 text-[13px] font-semibold leading-5 text-foreground/86">
                {lookup.pageContext.title || lookup.pageContext.url}
              </div>
              <div className="mt-2 text-[12px] leading-5 text-foreground/68">
                Bring this page into chat with its transient browser context attached.
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAttach(lookup.lookupId, buildAskCurrentPagePrompt(lookup))}
              className="shrink-0 rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] px-3 py-1.5 text-[11px] font-semibold text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
            >
              {attachLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {lookup.hits.slice(0, 3).map((hit) => (
            <div
              key={hit.id}
              className="rounded-[20px] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(245,239,230,0.52))] px-3 py-3 dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(55,45,31,0.78),rgba(24,22,20,0.92))]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
                    {hit.source}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold leading-5 text-foreground/86">
                    {hit.title}
                  </div>
                  {hit.subtitle ? (
                    <div className="mt-1 text-[11px] text-foreground/45">
                      {hit.subtitle}
                    </div>
                  ) : null}
                  <div className="mt-2 text-[12px] leading-5 text-foreground/68">
                    {hit.summary}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAttach(lookup.lookupId, buildBrowserLookupPrompt(lookup, hit))}
                  className="shrink-0 rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] px-3 py-1.5 text-[11px] font-semibold text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
                >
                  {attachLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function IslandExpandedView({
  headerDragRegion = false,
}: {
  headerDragRegion?: boolean;
} = {}) {
  const {
    statusLabel,
    recentMessages,
    pendingApproval,
    browserLookup,
    selectionContext,
    isBusy,
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    stageHistory,
    collapse,
    sendQuickReply,
    runSelectionAction,
    approvePendingApproval,
    rejectPendingApproval,
    restoreWorkspace,
    attachBrowserLookup,
    dismissBrowserLookup,
    dismissSelectionContext,
  } = useIslandContext();
  const t = useI18n("chat");

  const isActive =
    statusLabel === "Working..." || statusLabel === "Pending approval";
  const latestUserMessage = findLatestRecentMessage(recentMessages, "user");
  const latestAssistantMessage = findLatestRecentMessage(
    recentMessages,
    "assistant",
  );
  const isApprovalFocused = Boolean(pendingApproval);
  const statusLabelKey = resolveIslandStatusLabelKey(statusLabel);
  const showTimeline = Boolean(
    statusStage || statusCode || stageHistory.length > 0 || pendingApproval,
  );
  const sendFooterReply =
    selectionContext?.activeAction === "ask"
      ? (text: string) => runSelectionAction("ask", { question: text })
      : sendQuickReply;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "100%" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className="flex flex-col h-full overflow-hidden"
    >
      {/* Header - Pinned at top */}
      <motion.div
        data-tauri-drag-region={headerDragRegion ? "true" : undefined}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="shrink-0"
      >
        <motion.div variants={itemVariants} className="px-3.5 py-3">
          <div className="flex items-center gap-2 rounded-[999px] border border-white/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(244,238,232,0.62))] px-2.5 py-2 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.32)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(47,38,27,0.92),rgba(24,21,18,0.92))]">
            <div className="flex items-center gap-2.5 rounded-full bg-white/55 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:bg-white/6">
              <IslandSeedLogo size={18} isActive={isActive} />
              <div className="flex items-center gap-1.5">
                <div className="relative flex h-2 w-2">
                  <span
                    className={cn(
                      "absolute inline-flex h-full w-full rounded-full opacity-75",
                      isActive ? "animate-ping bg-amber-400" : "bg-emerald-400",
                    )}
                  />
                  <span
                    className={cn(
                      "relative inline-flex rounded-full h-2 w-2",
                      isActive ? "bg-amber-400" : "bg-emerald-400",
                    )}
                  />
                </div>
                <span className="text-[11px] font-semibold text-foreground/76">
                  {statusLabelKey ? t(statusLabelKey) : statusLabel}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1 rounded-full bg-white/45 px-3 py-1.5 text-[11px] text-foreground/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:bg-white/6">
              {isApprovalFocused
                ? t("island.hints.pending")
                : isActive
                  ? t("island.hints.active")
                  : t("island.hints.idle")}
            </div>
            <button
              onClick={collapse}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/55 transition-colors hover:bg-island-gold/14 dark:bg-white/6"
            >
              <ChevronUp className="h-3.5 w-3.5 text-island-gold" />
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Main Content Area - Scrollable */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="min-h-0 flex-1 overflow-y-auto island-content-scrollbar"
      >
        <motion.div variants={itemVariants} className="space-y-3 px-3.5 pb-3">
          {pendingApproval ? (
            <motion.div variants={itemVariants}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
                {t("island.approvalTitle")}
              </p>
              <IslandApprovalCard
                title={pendingApproval.title}
                desc={pendingApproval.desc}
                onApprove={approvePendingApproval}
                onReject={rejectPendingApproval}
                disabled={isBusy}
              />
            </motion.div>
          ) : null}
          {selectionContext && !pendingApproval ? (
            <IslandSelectionPanel
              selection={selectionContext}
              isBusy={isBusy}
              onRunAction={(kind, options) => {
                void runSelectionAction(kind, options);
              }}
              onDismiss={(selectionId) => {
                void dismissSelectionContext(selectionId);
              }}
            />
          ) : null}
          {browserLookup ? (
            <IslandBrowserLookupCard
              lookup={browserLookup}
              onAttach={(lookupId, prompt) => {
                void attachBrowserLookup(lookupId, prompt)
              }}
              onDismiss={(lookupId) => {
                void dismissBrowserLookup(lookupId)
              }}
              title={t("island.lookup.title")}
              attachLabel={t("island.lookup.attach")}
              dismissLabel={t("island.lookup.dismiss")}
            />
          ) : null}
          {showTimeline ? (
            <div className="rounded-[26px] border border-white/40 bg-white/42 p-2.5 shadow-[0_18px_42px_-34px_rgba(0,0,0,0.35)] dark:border-white/8 dark:bg-white/4">
              <IslandStatusTimeline
                statusLabel={statusLabel}
                statusStage={statusStage}
                statusCode={statusCode}
                statusMeta={statusMeta}
                stageHistory={stageHistory}
                isBusy={isBusy}
              />
            </div>
          ) : null}
          {latestUserMessage ? (
            <IslandUserIntentChip
              message={latestUserMessage}
              requestLabel={t("island.requestLabel")}
            />
          ) : null}
          <IslandAssistantPanel
            message={latestAssistantMessage}
            isActive={isActive}
            compact={isApprovalFocused}
            responseTitle={t("island.responseTitle")}
            liveBadge={t("island.badges.live")}
            latestBadge={t("island.badges.latest")}
            emptyText={t("island.keepNearby")}
            approvalEmptyText={t("island.approvalEmpty")}
          />

          {!isApprovalFocused ? null : (
            <div className="rounded-[22px] border border-white/35 bg-white/38 px-3.5 py-3 shadow-[0_12px_24px_-20px_rgba(0,0,0,0.26)] dark:border-white/8 dark:bg-white/4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
                <MessageSquareText className="h-3.5 w-3.5 text-island-gold/72" />
                <span>{t("island.decisionTitle")}</span>
              </div>
              <p className="text-[12px] leading-5 text-foreground/62">
                {t("island.decisionDescription")}
              </p>
            </div>
          )}
        </motion.div>

        {errorMessage ? (
          <motion.div
            variants={itemVariants}
            className="mx-3.5 mb-3 rounded-[22px] border border-amber-300/40 bg-amber-50/70 px-3.5 py-3 text-[11px] text-amber-700 shadow-[0_14px_28px_-24px_rgba(120,53,15,0.4)] dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/70 dark:text-amber-300/70">
              {t("island.attentionTitle")}
            </div>
            <div className="leading-5">{errorMessage}</div>
          </motion.div>
        ) : null}
      </motion.div>

      {/* Footer Area - Pinned at bottom */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="shrink-0 px-3.5 pb-3"
      >
        <motion.div
          variants={itemVariants}
          className="rounded-[26px] border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(246,241,235,0.68))] p-2 shadow-[0_22px_48px_-32px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(44,37,29,0.94),rgba(23,20,18,0.96))]"
        >
          <div className="flex items-center gap-2 rounded-[22px] bg-white/48 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.58)] dark:bg-white/5">
            <div className="hidden min-w-0 rounded-[18px] bg-white/42 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] md:block">
              {selectionContext?.activeAction === "ask"
                ? t("island.selection.askFooter")
                : t("island.continueHere")}
            </div>
            <div className="min-w-0 flex-1">
              <IslandQuickReply onSend={sendFooterReply} disabled={isBusy} />
            </div>
            <button
              onClick={restoreWorkspace}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

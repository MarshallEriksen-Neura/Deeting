'use client';

import { ArrowUp, Sliders, MessageSquarePlus, Paperclip, X, Square, FileText, Play, Check, Loader2 } from 'lucide-react';
import { useMemo, useRef, useState, useCallback, useEffect, memo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useChatRuntimeStore } from '@/store/chat-runtime-store';
import { useI18n } from '@/hooks/use-i18n';
import { useOpenWorkflow } from '@/hooks/use-open-workflow';
import { isTauriRuntime as detectTauriRuntime } from '@/lib/runtime/tauri';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BrowserModeConfirmationBar } from '@/components/chat/browser-mode/browser-mode-confirmation-bar';
import { TakeoverPendingBar } from '@/components/chat/takeover/takeover-pending-bar';
import { RecoveryActionBar } from '@/components/chat/recovery/recovery-action-bar';
import { WorkflowSuggestionBar } from '@/components/chat/console/workflow-suggestion-bar';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/utils/file';
import { getLocalBrowserAgentPageSnapshot } from '@/lib/api/browser-agent';
import { buildPageInspectionResult, isPageInspectionPrompt } from '@/lib/browser/page-inspection';
import { buildChatAttachments, UPLOAD_ERROR_CODES, ATTACHMENT_INVALID_ERROR_CODES } from '@/lib/chat/attachments';
import { createConversation } from '@/lib/api/conversations';
import { recoverDesktopLocalChatExecution } from '@/lib/api/mcp-desktop';
import { useChatMessaging } from '@/hooks/chat/use-chat-messaging';
import { listLocalUserDocuments } from '@/lib/api/knowledge';
import { generateWorkflowProposal } from '@/lib/workflow/commands';
import type { KnowledgeFile } from '@/types/knowledge';
import { listCustomTaskAgents, type CustomTaskAgentProfile } from '@/lib/api/custom-task-agents';
import { matchesChatModelSelectionValue } from '@/lib/api/models';
import { resolveLeadingTaskAgentMention } from '@/hooks/chat/task-agent-mention';
import { useBrowserModeStore } from '@/store/browser-mode-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { deriveAssistantActivityState } from '@/lib/chat/assistant-activity';
import { extractLatestComposerRecoveryPrompt } from '@/lib/chat/recovery';
import { shouldSuggestWorkflowPlanning } from '@/lib/chat/workflow-planning-suggestion';

type ComposerMode = 'chat' | 'workflow';

function buildWorkflowPlanningHints(agent?: CustomTaskAgentProfile | null) {
  if (!agent) return undefined;
  return [
    `Preferred executor / phase owner: @${agent.name} (agent id: ${agent.id}).`,
    'Use this agent as the default owner for relevant phases when building the plan.',
  ].join('\n');
}

function resolveWorkflowGoal(
  rawInput: string,
  resolvedMention: ReturnType<typeof resolveLeadingTaskAgentMention>,
) {
  const trimmedInput = rawInput.trim();
  const mentionedPrompt = resolvedMention?.agent
    ? resolvedMention.mention.prompt.trim()
    : '';

  if (mentionedPrompt) {
    return mentionedPrompt;
  }

  return trimmedInput;
}

/**
 * ControlsContainer - 聊天控制面板组件
 *
 * 功能：
 * - 消息输入和发送
 * - 附件管理（图片上传、预览、删除）
 * - 参数配置（temperature, topP）
 * - 桌面知识文件挂载
 * - 新建会话
 * - 模式切换（聊天/图像/代码）
 *
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 useMemo 缓存计算值
 */
function ControlsContainer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isKnowledgePickerOpen, setIsKnowledgePickerOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeLoadError, setKnowledgeLoadError] = useState<string | null>(null);
  const [taskAgents, setTaskAgents] = useState<CustomTaskAgentProfile[]>([]);
  const [dismissedRecoveryMessageIds, setDismissedRecoveryMessageIds] = useState<string[]>([]);
  const [composerMode, setComposerMode] = useState<ComposerMode>('chat');
  const [isPlanningWorkflow, setIsPlanningWorkflow] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useI18n('chat');
  const openWorkflow = useOpenWorkflow();
  const {
    input,
    attachments,
    messages,
    sessionId,
    selectedKnowledgeFileIds,
    setInput,
    setMessages,
    loadHistory,
    models,
    config,
    setConfig,
    addAttachments,
    removeAttachment,
    clearAttachments,
    toggleSelectedKnowledgeFileId,
    clearSelectedKnowledgeFileIds,
  } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      attachments: state.attachments,
      messages: state.messages,
      sessionId: state.sessionId,
      selectedKnowledgeFileIds: state.selectedKnowledgeFileIds,
      setInput: state.setInput,
      setMessages: state.setMessages,
      loadHistory: state.loadHistory,
      models: state.models,
      config: state.config,
      setConfig: state.setConfig,
      addAttachments: state.addAttachments,
      removeAttachment: state.removeAttachment,
      clearAttachments: state.clearAttachments,
      toggleSelectedKnowledgeFileId: state.toggleSelectedKnowledgeFileId,
      clearSelectedKnowledgeFileIds: state.clearSelectedKnowledgeFileIds,
    }))
  );
  const {
    isLoading,
    setSessionId,
    setGlobalLoading,
    resetSession,
  } = useChatRuntimeStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      setSessionId: state.setSessionId,
      setGlobalLoading: state.setGlobalLoading,
      resetSession: state.resetSession,
    }))
  );

  const isTauriRuntime = detectTauriRuntime();
  const browserModePage = useBrowserModeStore((state) => state.page)
  const openWorkspaceView = useWorkspaceStore((state) => state.openView)

  const {
    handleSendMessage,
    pendingTakeover,
    pendingTakeoverRequestedAction,
    queuePendingTakeoverFromCurrentDraft,
    stopAndSendPendingTakeover,
    markPendingTakeoverForDeferredSend,
    cancelPendingTakeover,
    cancelActiveRequest,
    regenerateMessage,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  } = useChatMessaging({
    isTauriRuntime,
  });

  // 缓存计算值
  const hasComposerContent = useMemo(
    () => Boolean(input.trim().length > 0 || attachments.length > 0),
    [input, attachments.length]
  );
  const latestAssistantActivity = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'assistant') continue;
      return deriveAssistantActivityState(message.blocks);
    }
    return deriveAssistantActivityState([]);
  }, [messages]);
  const recoveryPrompt = useMemo(() => {
    const latest = extractLatestComposerRecoveryPrompt(messages);
    if (!latest) return null;
    if (dismissedRecoveryMessageIds.includes(latest.messageId)) {
      return null;
    }
    return latest;
  }, [dismissedRecoveryMessageIds, messages]);
  const isApprovalFlowActive = useMemo(
    () => !isLoading && latestAssistantActivity.isActive,
    [isLoading, latestAssistantActivity.isActive]
  );
  const canSend = useMemo(
    () => Boolean(models.length > 0 && hasComposerContent && !isLoading && !isApprovalFlowActive),
    [models.length, hasComposerContent, isLoading, isApprovalFlowActive]
  );
  const canQueuePendingTakeover = useMemo(
    () => Boolean(models.length > 0 && hasComposerContent && (isLoading || isApprovalFlowActive)),
    [models.length, hasComposerContent, isLoading, isApprovalFlowActive]
  );
  const selectedModel = useMemo(
    () =>
      models.find((model) => matchesChatModelSelectionValue(model, config.model)) ??
      models[0],
    [models, config.model]
  );
  const resolvedTaskAgentMention = useMemo(() => {
    if (!isTauriRuntime) return null;
    return resolveLeadingTaskAgentMention(
      input,
      taskAgents.map((agent) => ({ id: agent.id, name: agent.name })),
    );
  }, [input, isTauriRuntime, taskAgents]);

  const knowledgeFileMap = useMemo(() => {
    return new Map(knowledgeFiles.map((file) => [file.id, file]));
  }, [knowledgeFiles]);
  const workflowGoal = useMemo(
    () => resolveWorkflowGoal(input, resolvedTaskAgentMention),
    [input, resolvedTaskAgentMention]
  );
  const hasWorkflowGoal = workflowGoal.trim().length > 0;
  const hasResolvedTaskAgent = !resolvedTaskAgentMention || Boolean(resolvedTaskAgentMention.agent);
  const showWorkflowSuggestion = useMemo(
    () => Boolean(
      isTauriRuntime &&
      composerMode === 'chat' &&
      hasWorkflowGoal &&
      hasResolvedTaskAgent &&
      !isLoading &&
      !isApprovalFlowActive &&
      shouldSuggestWorkflowPlanning(workflowGoal)
    ),
    [
      composerMode,
      hasResolvedTaskAgent,
      hasWorkflowGoal,
      isApprovalFlowActive,
      isLoading,
      isTauriRuntime,
      workflowGoal,
    ]
  );

  const isGenerating = isLoading;
  const isApprovalPending = latestAssistantActivity.statusCode === 'approval.required';
  const isApprovalExecuting = latestAssistantActivity.statusCode === 'approval.executing';
  const isApprovalBusy = isApprovalFlowActive && !hasComposerContent;
  const canGeneratePlan = useMemo(
    () => Boolean(
      isTauriRuntime &&
      hasWorkflowGoal &&
      hasResolvedTaskAgent &&
      !isLoading &&
      !isApprovalFlowActive &&
      !isPlanningWorkflow
    ),
    [
      hasResolvedTaskAgent,
      hasWorkflowGoal,
      isApprovalFlowActive,
      isLoading,
      isPlanningWorkflow,
      isTauriRuntime,
    ]
  );
  const canContinueGeneration = useMemo(
    () =>
      !recoveryPrompt &&
      !isGenerating &&
      hasInterruptedGeneration &&
      input.trim().length === 0 &&
      attachments.length === 0,
    [attachments.length, hasInterruptedGeneration, input, isGenerating, recoveryPrompt]
  );
  const sendButtonDisabled = useMemo(() => {
    if (isPlanningWorkflow) return true;
    if (isGenerating) return false;
    if (canQueuePendingTakeover) return false;
    if (canContinueGeneration) return false;
    if (isApprovalBusy) return true;
    return composerMode === 'workflow' ? !canGeneratePlan : !canSend;
  }, [
    canContinueGeneration,
    canGeneratePlan,
    canQueuePendingTakeover,
    canSend,
    composerMode,
    isApprovalBusy,
    isGenerating,
    isPlanningWorkflow,
  ]);
  const sendButtonAriaLabel = useMemo(() => {
    if (isPlanningWorkflow) {
      return t("controls.generatingPlan");
    }
    if (isGenerating) {
      return hasComposerContent ? t("controls.queueTakeover") : t("controls.stop");
    }
    if (canQueuePendingTakeover) {
      return t("controls.queueTakeover");
    }
    if (isApprovalPending) {
      return t("approvalDialog.title");
    }
    if (isApprovalExecuting) {
      return t("approvalDialog.actions.approving");
    }
    if (canContinueGeneration) {
      return t("controls.continue");
    }
    return composerMode === 'workflow'
      ? t("controls.generatePlan")
      : t("controls.send");
  }, [
    canContinueGeneration,
    canQueuePendingTakeover,
    composerMode,
    hasComposerContent,
    isApprovalExecuting,
    isApprovalPending,
    isGenerating,
    isPlanningWorkflow,
    t,
  ]);
  
  // 缓存事件处理函数
  const handleParamsOpenChange = useCallback((open: boolean) => {
    setIsParamsOpen(open);
  }, []);

  const loadIndexedKnowledgeFiles = useCallback(async () => {
    if (!isTauriRuntime) return;
    setKnowledgeLoading(true);
    setKnowledgeLoadError(null);
    try {
      const files = await listLocalUserDocuments({ status: "indexed" });
      setKnowledgeFiles(files);
    } catch (error) {
      console.warn("load_indexed_knowledge_files_failed", error);
      setKnowledgeLoadError(t("controls.knowledgePickerLoadFailed"));
    } finally {
      setKnowledgeLoading(false);
    }
  }, [isTauriRuntime, t]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    if (!isKnowledgePickerOpen) return;
    void loadIndexedKnowledgeFiles();
  }, [isTauriRuntime, isKnowledgePickerOpen, loadIndexedKnowledgeFiles]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    let cancelled = false;
    void listCustomTaskAgents()
      .then((items) => {
        if (!cancelled) setTaskAgents(items);
      })
      .catch((error) => {
        console.warn("load_task_agents_failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isTauriRuntime]);

  const handleNewChat = useCallback(async () => {
    resetSession();
    setMessages([]);
    clearAttachments();
    setGlobalLoading(true);
    try {
      const created = await createConversation({});
      if (created.session_id) {
        setSessionId(created.session_id);
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(searchParams?.toString());
          params.set("session", created.session_id);
          params.delete("agentId");
          const basePath = "/chat";
          const query = params.toString();
          const nextUrl = query ? `${basePath}?${query}` : basePath;
          window.history.replaceState(null, "", nextUrl);
        }
        return;
      }
    } catch (error) {
      console.warn("create_conversation_failed", error);
    } finally {
      setGlobalLoading(false);
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(searchParams?.toString());
      params.delete("session");
      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      window.history.replaceState(null, "", url || "/chat");
    }
  }, [
    resetSession,
    setMessages,
    clearAttachments,
    searchParams,
    pathname,
    setSessionId,
    setGlobalLoading,
  ]);

  const handleGeneratePlan = useCallback(async () => {
    if (!isTauriRuntime || !canGeneratePlan) return;
    if (!hasResolvedTaskAgent) {
      toast.error(
        t("input.taskAgentMissing", {
          name: resolvedTaskAgentMention?.mention.agentName ?? "",
        })
      );
      return;
    }

    setIsPlanningWorkflow(true);
    try {
      const run = await generateWorkflowProposal({
        goal: workflowGoal,
        hints: buildWorkflowPlanningHints(resolvedTaskAgentMention?.agent ?? null),
      });
      openWorkflow({ goal: workflowGoal, runId: run.id });
      setInput("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setIsPlanningWorkflow(false);
    }
  }, [
    canGeneratePlan,
    hasResolvedTaskAgent,
    isTauriRuntime,
    openWorkflow,
    resolvedTaskAgentMention,
    setInput,
    t,
    workflowGoal,
  ]);

  const handleSend = useCallback(async () => {
    if (canQueuePendingTakeover) {
      queuePendingTakeoverFromCurrentDraft("send_after_step");
      return;
    }
    if (composerMode === 'workflow') {
      await handleGeneratePlan();
      return;
    }
    if (!canSend) return;
    if (
      isTauriRuntime &&
      isPageInspectionPrompt(input) &&
      browserModePage?.tabId
    ) {
      const snapshot = await getLocalBrowserAgentPageSnapshot(browserModePage.tabId)
      const result = buildPageInspectionResult(snapshot)
      openWorkspaceView({
        id: `browser-inspection-${browserModePage.tabId}`,
        type: "native-canvas",
        title: t("inspection.title"),
        content: {
          viewType: "page-inspection",
          result,
        },
      })
      setInput("")
      return
    }

    handleSendMessage();
  }, [
    browserModePage,
    canSend,
    canQueuePendingTakeover,
    composerMode,
    handleGeneratePlan,
    handleSendMessage,
    input,
    isTauriRuntime,
    openWorkspaceView,
    queuePendingTakeoverFromCurrentDraft,
    setInput,
    t,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setAttachmentError(null);
    const result = await buildChatAttachments(files, {
      model: selectedModel?.id,
      providerModelId: selectedModel?.provider_model_id ?? undefined,
    });
    if (result.attachments.length) {
      addAttachments(result.attachments);
    }
    if (result.rejected > 0) {
      const hasInvalidError = result.errors.some((error) =>
        ATTACHMENT_INVALID_ERROR_CODES.has(error)
      );
      if (hasInvalidError) {
        setAttachmentError(t("input.attachment.errorInvalid"));
        return;
      }
      const hasUploadError = result.errors.some((error) =>
        UPLOAD_ERROR_CODES.has(error)
      );
      setAttachmentError(
        hasUploadError ? t("input.attachment.errorUpload") : t("input.attachment.errorRead")
      );
    }
  }, [t, addAttachments, selectedModel]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    if (isLoading) return;
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const files = Array.from(items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];
    if (files.length) {
      void handleFiles(files);
    }
  }, [isLoading, handleFiles]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length) {
      await handleFiles(files);
      event.target.value = "";
    }
  }, [handleFiles]);

  const handleTemperatureChange = useCallback((value: number[]) => {
    setConfig({ temperature: Number(value[0].toFixed(2)) });
  }, [setConfig]);

  const handleTemperatureEnabledChange = useCallback((checked: boolean) => {
    setConfig({ temperatureEnabled: checked });
  }, [setConfig]);

  const handleTopPChange = useCallback((value: number[]) => {
    setConfig({ topP: Number(value[0].toFixed(2)) });
  }, [setConfig]);

  const handleInputFocus = useCallback(() => {
  }, []);

  const handleFileInputClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKnowledgePickerOpenChange = useCallback((open: boolean) => {
    setIsKnowledgePickerOpen(open);
  }, []);

  const handleToggleKnowledgeFile = useCallback((fileId: string) => {
    toggleSelectedKnowledgeFileId(fileId);
  }, [toggleSelectedKnowledgeFileId]);

  const handleRemoveKnowledgeFile = useCallback((fileId: string) => {
    toggleSelectedKnowledgeFileId(fileId);
  }, [toggleSelectedKnowledgeFileId]);

  const handleClearKnowledgeFiles = useCallback(() => {
    clearSelectedKnowledgeFileIds();
  }, [clearSelectedKnowledgeFileIds]);

  useEffect(() => {
    setDismissedRecoveryMessageIds((previous) =>
      previous.filter((messageId) => messages.some((message) => message.id === messageId))
    );
  }, [messages]);

  const dismissRecoveryPrompt = useCallback((messageId: string | null | undefined) => {
    if (!messageId) return;
    setDismissedRecoveryMessageIds((previous) =>
      previous.includes(messageId) ? previous : [...previous, messageId]
    );
  }, []);

  const handleRecoveryContinue = useCallback(() => {
    if (!recoveryPrompt) return;
    const normalizedStage = recoveryPrompt.stage?.trim().toLowerCase() ?? '';
    if (
      recoveryPrompt.executionId &&
      sessionId &&
      (normalizedStage === 'resuming_after_approval' || normalizedStage === 'resume_failed')
    ) {
      void recoverDesktopLocalChatExecution({
        executionGraphExecutionId: recoveryPrompt.executionId,
        action: 'continue',
      })
        .then(async () => {
          await loadHistory(sessionId);
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : 'Failed to continue local recovery'
          );
        });
      return;
    }
    dismissRecoveryPrompt(recoveryPrompt.messageId);
    if (hasInterruptedGeneration) {
      void continueInterruptedGeneration();
      return;
    }
    void regenerateMessage(recoveryPrompt.messageId);
  }, [
    continueInterruptedGeneration,
    dismissRecoveryPrompt,
    hasInterruptedGeneration,
    loadHistory,
    recoveryPrompt,
    regenerateMessage,
    sessionId,
  ]);

  const handleRecoveryRetry = useCallback(() => {
    if (!recoveryPrompt) return;
    const normalizedStage = recoveryPrompt.stage?.trim().toLowerCase() ?? '';
    if (
      recoveryPrompt.executionId &&
      sessionId &&
      (normalizedStage === 'resuming_after_approval' || normalizedStage === 'resume_failed')
    ) {
      void recoverDesktopLocalChatExecution({
        executionGraphExecutionId: recoveryPrompt.executionId,
        action: 'retry',
      })
        .then(async () => {
          await loadHistory(sessionId);
        })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to retry local recovery');
      });
      return;
    }
    dismissRecoveryPrompt(recoveryPrompt.messageId);
    void regenerateMessage(recoveryPrompt.messageId);
  }, [dismissRecoveryPrompt, loadHistory, recoveryPrompt, regenerateMessage, sessionId]);

  const handleRecoveryAbandon = useCallback(() => {
    if (!recoveryPrompt) return;
    if (!recoveryPrompt.executionId || !sessionId) {
      dismissRecoveryPrompt(recoveryPrompt.messageId);
      return;
    }
    void recoverDesktopLocalChatExecution({
      executionGraphExecutionId: recoveryPrompt.executionId,
      action: 'abandon',
    })
      .then(async () => {
        await loadHistory(sessionId);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to abandon local recovery');
      });
  }, [dismissRecoveryPrompt, loadHistory, recoveryPrompt, sessionId]);

  const handleSendOrCancel = useCallback(() => {
    if (isGenerating) {
      if (hasComposerContent) {
        queuePendingTakeoverFromCurrentDraft("send_after_step");
        return;
      }
      void cancelActiveRequest();
      return;
    }
    if (canContinueGeneration) {
      void continueInterruptedGeneration();
      return;
    }
    void handleSend();
  }, [
    isGenerating,
    hasComposerContent,
    queuePendingTakeoverFromCurrentDraft,
    canContinueGeneration,
    cancelActiveRequest,
    continueInterruptedGeneration,
    handleSend,
  ]);

  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-[28px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-bg)] p-2.5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.38)] backdrop-blur-2xl supports-[backdrop-filter]:bg-[color:var(--ios-shell-bg)]">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-16 rounded-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_70%)] opacity-70 dark:opacity-40" />
      <BrowserModeConfirmationBar />

      {/* 1. Main Input Area */}
      <div className="relative pt-0.5">
        <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 flex flex-col gap-2">
          <RecoveryActionBar
            recovery={recoveryPrompt}
            disabled={isLoading || isApprovalFlowActive}
            onContinue={handleRecoveryContinue}
            onRetry={handleRecoveryRetry}
            onAbandon={handleRecoveryAbandon}
          />
          <TakeoverPendingBar
            pendingTakeover={pendingTakeover}
            requestedAction={pendingTakeoverRequestedAction}
            onImmediateStop={() => void stopAndSendPendingTakeover()}
            onSendAfterStep={() => void markPendingTakeoverForDeferredSend()}
            onCancel={() => void cancelPendingTakeover()}
          />
        </div>
        <div className="flex items-center rounded-[22px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="min-h-[44px] w-full bg-transparent border-0 shadow-none text-slate-800 dark:text-white/80 placeholder:text-slate-500 dark:placeholder:text-white/30 text-[15px] font-normal focus-visible:ring-0 focus-visible:border-transparent"
            placeholder={t("controls.placeholder")}
            aria-label={t("controls.placeholder")}
            autoFocus
            onFocus={handleInputFocus}
          />
          <Popover open={isParamsOpen} onOpenChange={handleParamsOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ios"
                size="icon"
                aria-label={`${t("hud.temperature")} / ${t("hud.topP")}`}
                title={`${t("hud.temperature")} / ${t("hud.topP")}`}
                className={cn(
                  "min-h-[44px] min-w-[44px] size-10 cursor-pointer",
                  isParamsOpen ? "ring-2 ring-[color:var(--ios-ring)]" : undefined,
                )}
              >
                <Sliders className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-72 rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white/95 dark:bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-2xl"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-white/80">
                      {t("hud.temperatureToggle")}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-white/40">
                      {config.temperatureEnabled
                        ? t("hud.temperatureEnabled")
                        : t("hud.temperatureDisabled")}
                    </div>
                  </div>
                  <Switch
                    checked={config.temperatureEnabled}
                    onCheckedChange={handleTemperatureEnabledChange}
                    aria-label={t("hud.temperatureToggle")}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-white/50 flex items-center gap-1.5">
                      {t("hud.temperature")}
                    </label>
                    <span className="text-[11px] font-mono font-bold">{config.temperature}</span>
                  </div>
                  <Slider
                    value={[config.temperature]}
                    min={0}
                    max={2}
                    step={0.1}
                    aria-label={t("hud.temperature")}
                    disabled={!config.temperatureEnabled}
                    onValueChange={handleTemperatureChange}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-white/50 flex items-center gap-1.5">
                      {t("hud.topP")}
                    </label>
                    <span className="text-[11px] font-mono font-bold">{config.topP}</span>
                  </div>
                  <Slider
                    value={[config.topP]}
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={t("hud.topP")}
                    disabled={!config.temperatureEnabled}
                    onValueChange={handleTopPChange}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {attachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {attachments.map((attachment) => {
            const isFileAttachment = attachment.kind === "file" || Boolean(attachment.fileId);

            if (isFileAttachment) {
              return (
                <div
                  key={attachment.id}
                  className="group relative flex h-16 w-52 shrink-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2 dark:border-white/10 dark:bg-slate-900/60"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                      {attachment.name ?? t("input.attachment.untitled")}
                    </div>
                    <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                      {typeof attachment.size === "number" ? formatFileSize(attachment.size) : attachment.type || ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                      "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                      "opacity-0 transition-opacity group-hover:opacity-100",
                      "shadow-sm"
                    )}
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={t("input.attachment.remove")}
                    disabled={isLoading}
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </button>
                </div>
              );
            }

            if (!attachment.url) {
              return null;
            }

            return (
              <div
                key={attachment.id}
                className="group relative h-16 w-16 shrink-0"
              >
                <div className="h-full w-full overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/10 bg-slate-100 dark:bg-slate-800 transition-colors group-hover:border-slate-300 dark:group-hover:border-white/20">
                  <Image
                    src={attachment.url}
                    alt={attachment.name ?? t("input.image.alt")}
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                </div>
                <button
                  type="button"
                  className={cn(
                    "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                    "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                    "opacity-0 transition-opacity group-hover:opacity-100",
                    "shadow-sm"
                  )}
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={t("input.attachment.remove")}
                  disabled={isLoading}
                >
                  <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {isTauriRuntime && selectedKnowledgeFileIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {selectedKnowledgeFileIds.map((fileId) => {
            const file = knowledgeFileMap.get(fileId);
            return (
              <div
                key={fileId}
                className="group relative flex h-8 max-w-[240px] shrink-0 items-center gap-2 rounded-full border border-sky-200/80 bg-sky-50 px-3 text-xs text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200"
              >
                <span className="truncate">
                  {file?.name ?? fileId}
                </span>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-sky-200/60 dark:hover:bg-sky-500/30"
                  onClick={() => handleRemoveKnowledgeFile(fileId)}
                  aria-label={t("controls.knowledgeRemove")}
                  disabled={isLoading}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-xs text-slate-600 dark:text-white/70"
            onClick={handleClearKnowledgeFiles}
            disabled={isLoading}
          >
            {t("controls.knowledgeClear")}
          </Button>
        </div>
      ) : null}

      {attachmentError ? (
        <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90">{attachmentError}</div>
      ) : null}

      {resolvedTaskAgentMention ? (
        <div className="text-center text-xs font-medium text-slate-500/90 dark:text-muted-foreground">
          {resolvedTaskAgentMention.agent
            ? t("input.taskAgentRouted", { name: resolvedTaskAgentMention.agent.name })
            : t("input.taskAgentMissing", { name: resolvedTaskAgentMention.mention.agentName })}
        </div>
      ) : null}

      {showWorkflowSuggestion ? (
        <WorkflowSuggestionBar onSwitchToWorkflow={() => setComposerMode('workflow')} />
      ) : null}

      {/* 2. Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* New Chat Button */}
          <Button
             type="button"
             variant="ios"
             size="icon"
             onClick={handleNewChat}
             aria-label={t("header.newChat")}
             className="min-h-[44px] min-w-[44px] size-11 cursor-pointer"
          >
             <MessageSquarePlus className="w-5 h-5" />
          </Button>

          {isTauriRuntime ? (
            <Popover open={isKnowledgePickerOpen} onOpenChange={handleKnowledgePickerOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ios"
                  size="icon"
                  aria-label={t("controls.knowledge")}
                  className="min-h-[44px] min-w-[44px] size-10 cursor-pointer"
                  disabled={isLoading}
                >
                  <FileText className="w-5 h-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                className="w-80 max-w-[calc(100vw-1rem)] rounded-[26px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-bg)] p-3 shadow-[0_24px_48px_-32px_rgba(15,23,42,0.45)] backdrop-blur-2xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-white/85">
                    {t("controls.knowledgePickerTitle")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="rounded-full"
                    onClick={() => void loadIndexedKnowledgeFiles()}
                    disabled={knowledgeLoading}
                  >
                    {knowledgeLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      t("controls.knowledgeRefresh")
                    )}
                  </Button>
                </div>

                {knowledgeLoading ? (
                  <div className="flex h-24 items-center justify-center text-sm text-slate-500 dark:text-white/50">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("controls.knowledgePickerLoading")}
                  </div>
                ) : knowledgeLoadError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
                    {knowledgeLoadError}
                  </div>
                ) : knowledgeFiles.length === 0 ? (
                  <div className="rounded-2xl border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] p-3 text-xs text-slate-500 dark:text-white/50">
                    {t("controls.knowledgePickerEmpty")}
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {knowledgeFiles.map((file) => {
                      const isSelected = selectedKnowledgeFileIds.includes(file.id);
                      return (
                        <button
                          key={file.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left transition-colors",
                            isSelected
                              ? "border-sky-200/70 bg-sky-100/90 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/20 dark:text-sky-200"
                              : "border-transparent hover:bg-[color:var(--ios-shell-subtle)]"
                          )}
                          onClick={() => handleToggleKnowledgeFile(file.id)}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{file.name}</span>
                            <span className="block truncate text-[10px] text-slate-500 dark:text-white/45">
                              {formatFileSize(file.size)} · {file.chunks ?? 0} chunks
                            </span>
                          </span>
                          {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : null}

          {isTauriRuntime ? (
            <>
              <ButtonGroup variant="ios" className="gap-1 p-1">
                <Button
                  type="button"
                  variant={composerMode === 'chat' ? 'ios-segment-active' : 'ios-segment'}
                  size="sm"
                  onClick={() => setComposerMode('chat')}
                  aria-label={t("controls.modeChat")}
                  className="h-9 px-4 text-xs"
                >
                  {t("controls.modeChat")}
                </Button>
                <Button
                  type="button"
                  variant={composerMode === 'workflow' ? 'ios-segment-active' : 'ios-segment'}
                  size="sm"
                  onClick={() => setComposerMode('workflow')}
                  aria-label={t("controls.modeWorkflow")}
                  className="h-9 px-4 text-xs"
                >
                  {t("controls.modeWorkflow")}
                </Button>
              </ButtonGroup>

              <Button
                type="button"
                variant="ios"
                size="sm"
                onClick={() => {
                  setComposerMode('workflow');
                  void handleGeneratePlan();
                }}
                aria-label={t("controls.generatePlan")}
                className="h-10 px-4 text-xs"
                disabled={!canGeneratePlan}
              >
                {isPlanningWorkflow ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span>{t("controls.generatePlan")}</span>
              </Button>
            </>
          ) : null}

          <Button
            type="button"
            variant="ios"
            size="icon"
            aria-label={t("input.attachment.add")}
            onClick={handleFileInputClick}
            className="min-h-[44px] min-w-[44px] size-10 cursor-pointer"
            disabled={isLoading}
          >
            <Paperclip className="w-5 h-5" />
          </Button>
        </div>

        {/* HUD Controls + Send */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handleSendOrCancel}
            disabled={sendButtonDisabled}
            variant="ios-primary"
            size="icon-lg"
            className={cn(
              "min-h-[46px] min-w-[46px] rounded-full",
              isApprovalBusy ? "cursor-wait opacity-85" : undefined,
              sendButtonDisabled && !isGenerating && !canQueuePendingTakeover && !canContinueGeneration
                ? "opacity-55"
                : "cursor-pointer",
            )}
            aria-label={sendButtonAriaLabel}
          >
            {isPlanningWorkflow ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isGenerating ? (
              hasComposerContent ? (
                <ArrowUp className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5" />
              )
            ) : canQueuePendingTakeover ? (
              <ArrowUp className="w-5 h-5" />
            ) : isApprovalBusy ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : canContinueGeneration ? (
              <Play className="w-5 h-5" />
            ) : composerMode === 'workflow' ? (
              <FileText className="w-5 h-5" />
            ) : (
              <ArrowUp className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>

      <Input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={isLoading}
      />
    </div>
  );
}

// 使用 React.memo 优化，避免不必要的重渲染
export default memo(ControlsContainer);

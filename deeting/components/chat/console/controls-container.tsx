'use client';

import { AlertCircle, ArrowUp, Bot, Check, ChevronsDown, ChevronsUp, CircleDashed, FileText, Globe, Loader2, MessageSquarePlus, Paperclip, Play, Presentation, RotateCcw, Search, Sliders, Square, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMemo, useRef, useState, useCallback, useEffect, memo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useChatRuntimeStore } from '@/store/chat-runtime-store';
import { usePendingTerminalSelection } from '@/hooks/chat/use-pending-terminal-selection';
import { useI18n } from '@/hooks/use-i18n';
import { useOpenWorkflow } from '@/hooks/use-open-workflow';
import { isTauriRuntime as detectTauriRuntime } from '@/lib/runtime/tauri';
import { Button } from '@/ui/shadcn/button';
import { GlassButton } from '@/ui/common/glass-button';
import { ImageLightbox } from '@/ui/common/image-lightbox';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';
import { Switch } from '@/ui/shadcn/switch';
import { BrowserModeConfirmationBar } from '@/components/chat/browser-mode/browser-mode-confirmation-bar';
import { TakeoverPendingBar } from '@/components/chat/takeover/takeover-pending-bar';
import { RecoveryActionBar } from '@/components/chat/recovery/recovery-action-bar';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Slider } from '@/ui/shadcn/slider';
import { Separator } from '@/ui/shadcn/separator';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/utils/file';
import {
  getLocalBrowserAgentActivePage,
  getLocalBrowserAgentPageSnapshot,
} from '@/lib/api/browser-agent';
import { buildChatPageContextAttachment } from '@/lib/browser/page-context';
import { buildPageInspectionResult, isPageInspectionPrompt } from '@/lib/browser/page-inspection';
import { buildChatAttachments, UPLOAD_ERROR_CODES, ATTACHMENT_INVALID_ERROR_CODES } from '@/lib/chat/attachments';
import { createConversation } from '@/lib/api/conversations';
import { recoverDesktopLocalChatExecution } from '@/lib/api/mcp-desktop';
import { useChatMessaging } from '@/hooks/chat/use-chat-messaging';
import { listLocalUserDocuments, retryFile } from '@/lib/api/knowledge';
import { generateWorkflowProposal } from '@/lib/workflow/commands';
import type { KnowledgeFile } from '@/types/knowledge';
import { listCustomTaskAgents, type CustomTaskAgentProfile } from '@/lib/api/custom-task-agents';
import { matchesChatModelSelectionValue } from '@/lib/api/models';
import {
  buildLeadingTaskAgentMentionInput,
  getLeadingTaskAgentMentionQuery,
  resolveLeadingTaskAgentMention,
} from '@/hooks/chat/task-agent-mention';
import { useBrowserModeStore } from '@/store/browser-mode-store';
import { useWorkspaceStore, type WorkspaceView } from '@/store/workspace-store';
import { useArtifactStore } from '@/store/artifact-store';
import { useWorkflowStore } from '@/store/workflow-store';
import { deriveAssistantActivityState } from '@/lib/chat/assistant-activity';
import { extractLatestComposerRecoveryPrompt } from '@/lib/chat/recovery';

type ComposerMode = 'chat' | 'workflow';
type KnowledgePickerFilter = 'all' | KnowledgeStatusTone;

type KnowledgeStatusTone = 'ready' | 'processing' | 'failed';
type WorkflowCanvasContent = {
  viewType: 'workflow';
  goal?: string;
  runId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkflowCanvasView(
  view: WorkspaceView,
): view is WorkspaceView & { type: 'native-canvas'; content: WorkflowCanvasContent } {
  if (view.type !== 'native-canvas') return false;
  const content = view.content;
  if (!isRecord(content) || content.viewType !== 'workflow') return false;
  return (
    (typeof content.goal === 'string' || typeof content.goal === 'undefined') &&
    (typeof content.runId === 'string' || typeof content.runId === 'undefined')
  );
}

function resolveKnowledgeStatusTone(status: KnowledgeFile['status']): KnowledgeStatusTone {
  if (status === 'active') return 'ready';
  if (status === 'failed') return 'failed';
  return 'processing';
}

function getKnowledgeStatusIcon(statusTone: KnowledgeStatusTone) {
  if (statusTone === 'ready') return Check;
  if (statusTone === 'processing') return CircleDashed;
  return AlertCircle;
}

function buildWorkflowPlanningHints(agent?: { id: string; name: string } | null) {
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
  const [knowledgePickerFilter, setKnowledgePickerFilter] = useState<KnowledgePickerFilter>('ready');
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState('');
  const [retryingKnowledgeFileIds, setRetryingKnowledgeFileIds] = useState<string[]>([]);
  const [taskAgents, setTaskAgents] = useState<CustomTaskAgentProfile[]>([]);
  const [taskAgentMentionActiveIndex, setTaskAgentMentionActiveIndex] = useState(0);
  const [isTaskAgentMentionPickerDismissed, setIsTaskAgentMentionPickerDismissed] = useState(false);
  const [dismissedRecoveryMessageIds, setDismissedRecoveryMessageIds] = useState<string[]>([]);
  const [composerMode, setComposerMode] = useState<ComposerMode>('chat');
  const [isPlanningWorkflow, setIsPlanningWorkflow] = useState(false);
  const [isAttachingPageContext, setIsAttachingPageContext] = useState(false);
  const [isImmersiveComposerCollapsed, setIsImmersiveComposerCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasMountedImmersiveComposerRef = useRef(false);
  const t = useI18n('chat');
  const prefersReducedMotion = useReducedMotion();
  const openWorkflow = useOpenWorkflow();
  const {
    input,
    attachments,
    messages,
    sessionId,
    selectedKnowledgeFileIds,
    pageContext,
    setInput,
    setMessages,
    loadHistory,
    models,
    config,
    setConfig,
    addAttachments,
    removeAttachment,
    clearAttachments,
    setPageContext,
    clearPageContext,
    toggleSelectedKnowledgeFileId,
    clearSelectedKnowledgeFileIds,
  } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      attachments: state.attachments,
      messages: state.messages,
      sessionId: state.sessionId,
      selectedKnowledgeFileIds: state.selectedKnowledgeFileIds,
      pageContext: state.pageContext,
      setInput: state.setInput,
      setMessages: state.setMessages,
      loadHistory: state.loadHistory,
      models: state.models,
      config: state.config,
      setConfig: state.setConfig,
      addAttachments: state.addAttachments,
      removeAttachment: state.removeAttachment,
      clearAttachments: state.clearAttachments,
      setPageContext: state.setPageContext,
      clearPageContext: state.clearPageContext,
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
  const { openWorkspaceView, workspaceViews, activeWorkspaceViewId } = useWorkspaceStore(
    useShallow((state) => ({
      openWorkspaceView: state.openView,
      workspaceViews: state.views,
      activeWorkspaceViewId: state.activeViewId,
    }))
  )
  const editingArtifact = useArtifactStore((state) => state.editingArtifact)
  const clearEditingArtifact = useArtifactStore((state) => state.clearEditingArtifact)
  const workflowRun = useWorkflowStore((state) => state.run)

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

  // 派生状态值
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
  const taskAgentMentionQuery = useMemo(
    () => (isTauriRuntime ? getLeadingTaskAgentMentionQuery(input) : null),
    [input, isTauriRuntime]
  );
  const mentionableTaskAgents = useMemo(
    () => taskAgents.filter((agent) => !agent.is_deleted && agent.is_enabled),
    [taskAgents]
  );
  const filteredTaskAgentMentionOptions = useMemo(() => {
    if (taskAgentMentionQuery === null) return [];
    const query = taskAgentMentionQuery.trim().toLowerCase();
    return mentionableTaskAgents
      .filter((agent) => {
        if (!query) return true;
        const searchable = [
          agent.name,
          agent.description ?? '',
          agent.invocation_kind,
          ...agent.tags,
        ]
          .join(' ')
          .toLowerCase();
        return searchable.includes(query);
      })
      .slice(0, 8);
  }, [mentionableTaskAgents, taskAgentMentionQuery]);
  const showTaskAgentMentionPicker = Boolean(
    isTauriRuntime &&
    !isTaskAgentMentionPickerDismissed &&
    taskAgentMentionQuery !== null &&
    filteredTaskAgentMentionOptions.length > 0
  );
  const resolvedTaskAgentMention = useMemo(() => {
    if (!isTauriRuntime) return null;
    return resolveLeadingTaskAgentMention(
      input,
      mentionableTaskAgents.map((agent) => ({ id: agent.id, name: agent.name })),
    );
  }, [input, isTauriRuntime, mentionableTaskAgents]);

  const knowledgeFileMap = useMemo(() => {
    return new Map(knowledgeFiles.map((file) => [file.id, file]));
  }, [knowledgeFiles]);
  const unavailableSelectedKnowledgeFiles = useMemo(() => {
    const unavailable: KnowledgeFile[] = [];
    for (const fileId of selectedKnowledgeFileIds) {
      const file = knowledgeFileMap.get(fileId);
      if (!file) continue;
      if (resolveKnowledgeStatusTone(file.status) !== 'ready') {
        unavailable.push(file);
      }
    }
    return unavailable;
  }, [knowledgeFileMap, selectedKnowledgeFileIds]);
  const filteredKnowledgeFiles = useMemo(() => {
    const query = knowledgeSearchQuery.trim().toLowerCase();
    return knowledgeFiles.filter((file) => {
      const statusTone = resolveKnowledgeStatusTone(file.status);
      if (knowledgePickerFilter !== 'all' && statusTone !== knowledgePickerFilter) {
        return false;
      }
      if (!query) return true;
      return file.name.toLowerCase().includes(query);
    });
  }, [knowledgeFiles, knowledgePickerFilter, knowledgeSearchQuery]);
  const hasUnavailableSelectedKnowledge = unavailableSelectedKnowledgeFiles.length > 0;
  const workflowGoal = useMemo(
    () => resolveWorkflowGoal(input, resolvedTaskAgentMention),
    [input, resolvedTaskAgentMention]
  );
  const hasWorkflowGoal = workflowGoal.trim().length > 0;
  const hasResolvedTaskAgent = !resolvedTaskAgentMention || Boolean(resolvedTaskAgentMention.agent);
  const isGenerating = isLoading;
  const isApprovalPending = latestAssistantActivity.statusCode === 'approval.required';
  const isApprovalExecuting = latestAssistantActivity.statusCode === 'approval.executing';
  const isApprovalBusy = isApprovalFlowActive && !hasComposerContent;
  const workflowComposerContext = useMemo(() => {
    const workflowViews = workspaceViews.filter(isWorkflowCanvasView);
    const activeWorkflowView = workflowViews.find(
      (view) => view.id === activeWorkspaceViewId
    );
    const openWorkflowView = activeWorkflowView ?? workflowViews[0];
    if (!openWorkflowView) return null;

    const viewRunId = openWorkflowView.content.runId ?? null;
    const isLoadedRun = Boolean(viewRunId && workflowRun?.id === viewRunId);
    const title = isLoadedRun && workflowRun?.title
      ? workflowRun.title
      : openWorkflowView.content.goal ?? null;

    return {
      isActive: openWorkflowView.id === activeWorkspaceViewId,
      title,
    };
  }, [activeWorkspaceViewId, workflowRun, workspaceViews]);
  const contextBarItems = useMemo(() => {
    const items: Array<{ key: string; tone: 'default' | 'warning' | 'danger' | 'active'; label: string; title?: string }> = [];
    if (recoveryPrompt) {
      items.push({ key: 'recovery', tone: 'warning', label: t('controls.contextBar.recovery') });
    }
    if (workflowComposerContext) {
      items.push({
        key: 'workflow-plan',
        tone: workflowComposerContext.isActive ? 'active' : 'default',
        label: t('controls.contextBar.workflowPlan'),
        title: workflowComposerContext.title ?? undefined,
      });
    }
    if (isApprovalPending) {
      items.push({ key: 'approval-pending', tone: 'warning', label: t('controls.contextBar.approvalPending') });
    } else if (isApprovalExecuting) {
      items.push({ key: 'approval-executing', tone: 'active', label: t('controls.contextBar.approvalExecuting') });
    }
    if (selectedKnowledgeFileIds.length > 0) {
      items.push({
        key: 'knowledge',
        tone: hasUnavailableSelectedKnowledge ? 'danger' : 'default',
        label: t('controls.contextBar.knowledge', { count: selectedKnowledgeFileIds.length }),
      });
    }
    if (pageContext) {
      items.push({ key: 'page-context', tone: 'default', label: t('controls.contextBar.pageContext') });
    }
    if (editingArtifact) {
      items.push({ key: 'artifact', tone: 'active', label: t('controls.contextBar.artifact') });
    }
    return items;
  }, [
    editingArtifact,
    hasUnavailableSelectedKnowledge,
    isApprovalExecuting,
    isApprovalPending,
    pageContext,
    recoveryPrompt,
    selectedKnowledgeFileIds.length,
    t,
    workflowComposerContext,
  ]);
  const composerPlaceholder = useMemo(() => {
    if (composerMode === 'workflow') return t("controls.workflowPlaceholder");
    if (workflowComposerContext) return t("controls.workflowContextPlaceholder");
    return t("controls.placeholder");
  }, [composerMode, t, workflowComposerContext]);
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
  const immersiveToggleLabel = useMemo(
    () => (
      isImmersiveComposerCollapsed
        ? t("controls.immersiveExpand")
        : t("controls.immersiveCollapse")
    ),
    [isImmersiveComposerCollapsed, t]
  );
  const composerTransition = useMemo(
    () => (
      prefersReducedMotion
        ? { duration: 0.16, ease: 'easeOut' as const }
        : { type: 'spring' as const, stiffness: 360, damping: 30, mass: 0.9 }
    ),
    [prefersReducedMotion]
  );
  const composerLayoutTransition = useMemo(
    () => (
      prefersReducedMotion
        ? { duration: 0.16, ease: 'easeOut' as const }
        : { type: 'spring' as const, stiffness: 320, damping: 32, mass: 0.86 }
    ),
    [prefersReducedMotion]
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

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setIsTaskAgentMentionPickerDismissed(false);
  }, [setInput]);

  const handleImmersiveComposerToggle = useCallback(() => {
    setIsImmersiveComposerCollapsed((current) => !current);
  }, []);

  const handleSelectTaskAgentMention = useCallback((agent: CustomTaskAgentProfile) => {
    setInput(buildLeadingTaskAgentMentionInput(agent.name, ''));
    setIsTaskAgentMentionPickerDismissed(true);
  }, [setInput]);

  // Bridge: the terminal panel writes selections into a shared store; this
  // hook drains them into the chat input and exposes a brief flash flag we
  // pulse on the input wrapper for visual confirmation.
  const { isFlashing: isBridgeFlashing } = usePendingTerminalSelection({
    inputRef,
  });

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;

    node.style.height = '0px';
    const nextHeight = Math.min(Math.max(node.scrollHeight, 44), 220);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > 220 ? 'auto' : 'hidden';
  }, [input]);

  useEffect(() => {
    if (!hasMountedImmersiveComposerRef.current) {
      hasMountedImmersiveComposerRef.current = true;
      return;
    }
    if (isImmersiveComposerCollapsed) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isImmersiveComposerCollapsed]);

  const loadKnowledgeFiles = useCallback(async () => {
    if (!isTauriRuntime) return;
    setKnowledgeLoading(true);
    setKnowledgeLoadError(null);
    try {
      const files = await listLocalUserDocuments();
      setKnowledgeFiles(files);
    } catch (error) {
      console.warn("load_knowledge_files_failed", error);
      setKnowledgeLoadError(t("controls.knowledgePickerLoadFailed"));
    } finally {
      setKnowledgeLoading(false);
    }
  }, [isTauriRuntime, t]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    if (!isKnowledgePickerOpen) return;
    void loadKnowledgeFiles();
  }, [isTauriRuntime, isKnowledgePickerOpen, loadKnowledgeFiles]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    if (selectedKnowledgeFileIds.length === 0) return;
    if (knowledgeFiles.length > 0 || knowledgeLoading) return;
    void loadKnowledgeFiles();
  }, [isTauriRuntime, knowledgeFiles.length, knowledgeLoading, loadKnowledgeFiles, selectedKnowledgeFileIds.length]);

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

  useEffect(() => {
    setTaskAgentMentionActiveIndex(0);
  }, [taskAgentMentionQuery, filteredTaskAgentMentionOptions.length]);

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

    setIsPlanningWorkflow(true);
    try {
      const run = await generateWorkflowProposal({
        goal: workflowGoal,
        hints: buildWorkflowPlanningHints(resolvedTaskAgentMention?.agent ?? null),
      });
      openWorkflow({ goal: workflowGoal, runId: run.id });
      setInput("");
      setComposerMode("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setIsPlanningWorkflow(false);
    }
  }, [
    canGeneratePlan,
    isTauriRuntime,
    openWorkflow,
    resolvedTaskAgentMention,
    setInput,
    workflowGoal,
  ]);

  const handleSend = useCallback(async () => {
    if (hasUnavailableSelectedKnowledge) {
      toast.error(t("controls.knowledgeUnavailableSelected"));
      return;
    }
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
    hasUnavailableSelectedKnowledge,
    input,
    isTauriRuntime,
    openWorkspaceView,
    queuePendingTakeoverFromCurrentDraft,
    setInput,
    t,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showTaskAgentMentionPicker && filteredTaskAgentMentionOptions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        setTaskAgentMentionActiveIndex((current) => {
          const next = current + direction;
          if (next < 0) return filteredTaskAgentMentionOptions.length - 1;
          if (next >= filteredTaskAgentMentionOptions.length) return 0;
          return next;
        });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsTaskAgentMentionPickerDismissed(true);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (e.nativeEvent.isComposing || e.keyCode === 229) {
          return;
        }
        e.preventDefault();
        const selectedAgent = filteredTaskAgentMentionOptions[taskAgentMentionActiveIndex];
        if (selectedAgent) {
          handleSelectTaskAgentMention(selectedAgent);
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      void handleSend();
    }
  }, [
    filteredTaskAgentMentionOptions,
    handleSend,
    handleSelectTaskAgentMention,
    showTaskAgentMentionPicker,
    taskAgentMentionActiveIndex,
  ]);

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

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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

  const handleReasoningEnabledChange = useCallback((checked: boolean) => {
    setConfig({ reasoningEnabled: checked });
  }, [setConfig]);

  const handleReasoningEffortChange = useCallback((effort: 'low' | 'medium' | 'high') => {
    setConfig({ reasoningEffort: effort });
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

  const handleRetryKnowledgeFile = useCallback(async (fileId: string) => {
    setRetryingKnowledgeFileIds((current) => Array.from(new Set([...current, fileId])));
    try {
      const nextFile = await retryFile(fileId);
      setKnowledgeFiles((current) =>
        current.map((file) => (file.id === fileId ? nextFile : file))
      );
      toast.success(t("controls.knowledgeRetryStarted"));
    } catch (error) {
      console.warn("retry_knowledge_file_failed", error);
      toast.error(t("controls.knowledgeRetryFailed"));
    } finally {
      setRetryingKnowledgeFileIds((current) => current.filter((id) => id !== fileId));
    }
  }, [t]);

  const handleAttachCurrentPageContext = useCallback(async () => {
    if (!isTauriRuntime) return;

    setIsAttachingPageContext(true);
    try {
      const activePage = await getLocalBrowserAgentActivePage();
      if (!activePage?.tabId) {
        toast.error(t("controls.pageContextUnavailable"));
        return;
      }

      const snapshot = await getLocalBrowserAgentPageSnapshot(activePage.tabId);
      setPageContext(buildChatPageContextAttachment(snapshot, activePage));
      toast.success(t("controls.pageContextAttached"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setIsAttachingPageContext(false);
    }
  }, [isTauriRuntime, setPageContext, t]);

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
        if (hasUnavailableSelectedKnowledge) {
          toast.error(t("controls.knowledgeUnavailableSelected"));
          return;
        }
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
    hasUnavailableSelectedKnowledge,
    queuePendingTakeoverFromCurrentDraft,
    canContinueGeneration,
    cancelActiveRequest,
    continueInterruptedGeneration,
    handleSend,
    t,
  ]);

  return (
    <div className="relative">
      <AnimatePresence initial={false} mode="wait">
        {!isImmersiveComposerCollapsed ? (
          <motion.div
            key="controls-expanded"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 24, scale: 0.985, filter: 'blur(10px)' }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 46, scale: 0.97, filter: 'blur(12px)' }}
            transition={composerTransition}
            className="relative flex flex-col gap-2 overflow-visible rounded-[28px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-bg)] p-2.5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.38)] backdrop-blur-2xl supports-[backdrop-filter]:bg-[color:var(--ios-shell-bg)]"
          >
            <div className="pointer-events-none absolute inset-x-8 top-0 h-16 rounded-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_70%)] opacity-70 dark:opacity-40" />
            <BrowserModeConfirmationBar />

      {/* 1. Main Input Area */}
      <motion.div
        layout="position"
        transition={{ layout: composerLayoutTransition }}
        className="relative pt-0.5"
      >
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
        {contextBarItems.length > 0 ? (
          <motion.div
            layout="position"
            transition={{ layout: composerLayoutTransition }}
            className="mb-2 flex flex-wrap items-center gap-1.5 px-1"
          >
            {contextBarItems.map((item) => (
              <span
                key={item.key}
                title={item.title}
                className={cn(
                  "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium",
                  item.tone === 'danger'
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200"
                    : item.tone === 'warning'
                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200"
                      : item.tone === 'active'
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-200"
                        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/65"
                )}
              >
                {item.label}
              </span>
            ))}
          </motion.div>
        ) : null}
        <div
          className={cn(
            "relative flex items-end rounded-[22px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
            isBridgeFlashing && "terminal-bridge-flash",
          )}
        >
              {showTaskAgentMentionPicker ? (
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-full max-w-[720px] overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/95 p-2 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.65)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#151515]/95">
                  <div className="px-3 pb-1.5 pt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
                    {t("input.taskAgentPickerTitle")}
                  </div>
                  <div className="max-h-72 overflow-y-auto pr-1">
                    {filteredTaskAgentMentionOptions.map((agent, index) => {
                      const isActive = index === taskAgentMentionActiveIndex;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 rounded-[16px] px-3 py-2 text-left transition-colors",
                            isActive
                              ? "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white"
                              : "text-slate-700 hover:bg-slate-50 dark:text-white/75 dark:hover:bg-white/[0.06]"
                          )}
                          onMouseEnter={() => setTaskAgentMentionActiveIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSelectTaskAgentMention(agent)}
                        >
                          <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                            isActive
                              ? "border-slate-300 bg-white text-slate-800 dark:border-white/20 dark:bg-white/10 dark:text-white"
                              : "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/45"
                          )}>
                            <Bot className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold">{agent.name}</span>
                              <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400 dark:border-white/10 dark:text-white/35">
                                {agent.invocation_kind.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div className="truncate text-xs text-slate-500 dark:text-white/40">
                              {agent.description || agent.task_prompt}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                className="max-h-[220px] min-h-[44px] w-full resize-none overflow-y-hidden border-0 bg-transparent px-0 py-[9px] text-[15px] font-normal leading-7 text-slate-800 shadow-none focus-visible:ring-0 focus-visible:border-transparent dark:text-white/80 placeholder:text-slate-500 dark:placeholder:text-white/30"
                placeholder={composerPlaceholder}
                aria-label={composerPlaceholder}
                autoFocus
                onFocus={handleInputFocus}
              />
              <div className="ml-3 flex shrink-0 items-end gap-2 self-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={immersiveToggleLabel}
                  title={immersiveToggleLabel}
                  onClick={handleImmersiveComposerToggle}
                  className="min-h-[44px] min-w-[44px] size-10 rounded-full border border-transparent text-slate-400 transition-all duration-200 hover:border-slate-200/90 hover:bg-white/80 hover:text-slate-700 dark:text-white/35 dark:hover:border-white/10 dark:hover:bg-white/[0.06] dark:hover:text-white/80"
                >
                  <ChevronsDown className="h-4 w-4" />
                </Button>
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
                      <Separator className="bg-slate-200/70 dark:bg-white/10" />
                      <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="space-y-0.5">
                          <div className="text-[11px] font-bold text-slate-700 dark:text-white/80">
                            {t("hud.reasoningToggle")}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-white/40">
                            {config.reasoningEnabled
                              ? t("hud.reasoningEnabled")
                              : t("hud.reasoningDisabled")}
                          </div>
                        </div>
                        <Switch
                          checked={config.reasoningEnabled}
                          onCheckedChange={handleReasoningEnabledChange}
                          aria-label={t("hud.reasoningToggle")}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center px-1">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-white/50 flex items-center gap-1.5">
                            {t("hud.reasoningEffort")}
                          </label>
                          <span className="text-[11px] font-mono font-bold uppercase">{config.reasoningEffort}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['low', 'medium', 'high'] as const).map((effort) => {
                            const active = config.reasoningEffort === effort
                            return (
                              <Button
                                key={effort}
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!config.reasoningEnabled}
                                onClick={() => handleReasoningEffortChange(effort)}
                                className={cn(
                                  "h-8 text-[11px] font-semibold capitalize",
                                  active
                                    ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                                    : "border-slate-200 dark:border-white/10"
                                )}
                              >
                                {t(`hud.reasoningEffortOptions.${effort}`)}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
        </div>
      </motion.div>

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
                <ImageLightbox
                  src={attachment.url}
                  alt={attachment.name ?? t("input.image.alt")}
                >
                  <div className="h-full w-full cursor-zoom-in overflow-hidden rounded-lg border border-slate-200/80 bg-slate-100 transition-colors group-hover:border-slate-300 dark:border-white/10 dark:bg-slate-800 dark:group-hover:border-white/20">
                    <Image
                      src={attachment.url}
                      alt={attachment.name ?? t("input.image.alt")}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </div>
                </ImageLightbox>
                <button
                  type="button"
                  className={cn(
                    "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                    "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                    "opacity-0 transition-opacity group-hover:opacity-100",
                    "shadow-sm"
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeAttachment(attachment.id);
                  }}
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

      {editingArtifact ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <div className="group relative flex h-8 max-w-[360px] shrink-0 items-center gap-2 rounded-full border border-violet-200/80 bg-violet-50 px-3 text-xs text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200">
            {editingArtifact.type === 'pptx' ? (
              <Presentation className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {t("controls.artifactContextLabel", {
                name: editingArtifact.name,
                version: editingArtifact.revisionNumber
                  ? t("controls.artifactVersion", { number: editingArtifact.revisionNumber })
                  : "",
              })}
            </span>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-violet-200/60 dark:hover:bg-violet-500/30"
              onClick={clearEditingArtifact}
              aria-label={t("controls.artifactContextRemove")}
              disabled={isLoading}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-white/45">
            {t("controls.artifactContextHint")}
          </span>
        </div>
      ) : null}

      {isTauriRuntime && selectedKnowledgeFileIds.length > 0 ? (
        <div className="flex flex-col gap-1 px-1">
          <div className="flex flex-wrap items-center gap-2">
            {selectedKnowledgeFileIds.map((fileId) => {
              const file = knowledgeFileMap.get(fileId);
              const statusTone = file ? resolveKnowledgeStatusTone(file.status) : 'ready';
              const StatusIcon = getKnowledgeStatusIcon(statusTone);
              const statusLabel = file ? t(`controls.knowledgeStatus.${statusTone}`) : t("controls.knowledgeStatus.unknown");
              const errorText = statusTone === 'failed' ? file?.errorMessage : null;
              return (
                <div
                  key={fileId}
                  className={cn(
                    "group relative flex min-h-8 max-w-[320px] shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                    statusTone === 'ready'
                      ? "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200"
                      : statusTone === 'processing'
                        ? "border-amber-200/80 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
                        : "border-red-200/80 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200"
                  )}
                  title={errorText ?? undefined}
                >
                  <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {file?.name ?? fileId}
                    </span>
                    <span className="block truncate text-[10px] opacity-75">
                      {statusLabel}{errorText ? ` · ${errorText}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
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
          {hasUnavailableSelectedKnowledge ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-200/85">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{t("controls.knowledgeUnavailableHint")}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {pageContext ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <div className="group relative flex h-8 max-w-[360px] shrink-0 items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 text-xs text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {pageContext.title || pageContext.host || pageContext.url}
            </span>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-emerald-200/60 dark:hover:bg-emerald-500/30"
              onClick={clearPageContext}
              aria-label={t("controls.pageContextRemove")}
              disabled={isLoading}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-white/45">
            {t("controls.pageContextHint")}
          </span>
        </div>
      ) : null}

      {attachmentError ? (
        <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90">{attachmentError}</div>
      ) : null}

      {/* 2. Action Row */}
      <motion.div
        layout="position"
        transition={{ layout: composerLayoutTransition }}
        className="flex flex-wrap items-center justify-between gap-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* New Chat Button */}
          <GlassButton
             type="button"
             variant="secondary"
             size="icon"
             onClick={handleNewChat}
             aria-label={t("header.newChat")}
             className="min-h-[44px] min-w-[44px] cursor-pointer"
          >
             <MessageSquarePlus className="w-5 h-5" />
          </GlassButton>

          {isTauriRuntime ? (
            <Popover open={isKnowledgePickerOpen} onOpenChange={handleKnowledgePickerOpenChange}>
              <PopoverTrigger asChild>
                <GlassButton
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label={t("controls.knowledge")}
                  className="min-h-[44px] min-w-[44px] cursor-pointer"
                  disabled={isLoading}
                >
                  <FileText className="w-5 h-5" />
                </GlassButton>
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
                    onClick={() => void loadKnowledgeFiles()}
                    disabled={knowledgeLoading}
                  >
                    {knowledgeLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      t("controls.knowledgeRefresh")
                    )}
                  </Button>
                </div>

                <div className="mb-2 space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={knowledgeSearchQuery}
                      onChange={(event) => setKnowledgeSearchQuery(event.target.value)}
                      placeholder={t("controls.knowledgeSearchPlaceholder")}
                      className="h-8 rounded-full pl-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['ready', 'processing', 'failed', 'all'] as KnowledgePickerFilter[]).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[10px] font-medium transition",
                          knowledgePickerFilter === filter
                            ? "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-200"
                            : "border-transparent text-slate-500 hover:bg-[color:var(--ios-shell-subtle)] dark:text-white/55"
                        )}
                        onClick={() => setKnowledgePickerFilter(filter)}
                      >
                        {t(`controls.knowledgeFilter.${filter}`)}
                      </button>
                    ))}
                  </div>
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
                ) : filteredKnowledgeFiles.length === 0 ? (
                  <div className="rounded-2xl border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] p-3 text-xs text-slate-500 dark:text-white/50">
                    {t("controls.knowledgePickerNoMatches")}
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {filteredKnowledgeFiles.map((file) => {
                      const isSelected = selectedKnowledgeFileIds.includes(file.id);
                      const statusTone = resolveKnowledgeStatusTone(file.status);
                      const isReady = statusTone === 'ready';
                      const statusLabel = t(`controls.knowledgeStatus.${statusTone}`);
                      const isRetrying = retryingKnowledgeFileIds.includes(file.id);
                      return (
                        <div
                          key={file.id}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed",
                            isSelected
                              ? "border-sky-200/70 bg-sky-100/90 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/20 dark:text-sky-200"
                              : isReady
                                ? "border-transparent hover:bg-[color:var(--ios-shell-subtle)]"
                                : statusTone === 'processing'
                                  ? "border-amber-200/70 bg-amber-50/70 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200"
                                  : "border-red-200/70 bg-red-50/80 text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200"
                          )}
                        >
                          <button
                            type="button"
                            disabled={!isReady && !isSelected}
                            className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                            onClick={() => {
                              if (isReady || isSelected) handleToggleKnowledgeFile(file.id);
                            }}
                          >
                            <span className="block truncate text-xs font-medium">{file.name}</span>
                            <span className="block truncate text-[10px] text-slate-500 dark:text-white/45">
                              {formatFileSize(file.size)} · {file.chunks ?? 0} {t("controls.knowledgeChunks")} · {statusLabel}
                            </span>
                            {statusTone === 'failed' && file.errorMessage ? (
                              <span className="mt-0.5 block truncate text-[10px] text-red-600/90 dark:text-red-200/80">
                                {file.errorMessage}
                              </span>
                            ) : null}
                            {statusTone === 'processing' ? (
                              <span className="mt-0.5 block truncate text-[10px] text-amber-700/80 dark:text-amber-200/75">
                                {t("controls.knowledgeProcessingHint")}
                              </span>
                            ) : null}
                          </button>
                          <span className="flex h-5 shrink-0 items-center justify-center gap-1">
                            {isSelected ? (
                              <Check className="h-4 w-4" />
                            ) : statusTone === 'processing' ? (
                              <CircleDashed className="h-4 w-4" />
                            ) : statusTone === 'failed' ? (
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-red-100/80 dark:hover:bg-red-500/20"
                                onClick={() => void handleRetryKnowledgeFile(file.id)}
                                disabled={isRetrying}
                                aria-label={t("controls.knowledgeRetry")}
                              >
                                {isRetrying ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : null}

          {isTauriRuntime ? (
            <GlassButton
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t("controls.attachCurrentPage")}
              className="h-10 px-4 text-xs cursor-pointer"
              onClick={() => {
                void handleAttachCurrentPageContext();
              }}
              disabled={isLoading || isAttachingPageContext}
            >
              {isAttachingPageContext ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              <span>
                {isAttachingPageContext
                  ? t("controls.attachingCurrentPage")
                  : t("controls.attachCurrentPage")}
              </span>
            </GlassButton>
          ) : null}

          {isTauriRuntime ? (
            <>
              <div className="flex items-center rounded-[calc(var(--radius)+999px)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/60 p-1 backdrop-blur-xl shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)]">
                <GlassButton
                  type="button"
                  variant={composerMode === 'chat' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setComposerMode('chat')}
                  aria-label={t("controls.modeChat")}
                  className="h-8 px-4 text-xs rounded-full border-0 shadow-none"
                >
                  {t("controls.modeChat")}
                </GlassButton>
                <GlassButton
                  type="button"
                  variant={composerMode === 'workflow' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setComposerMode('workflow')}
                  aria-label={t("controls.modeWorkflow")}
                  className="h-8 px-4 text-xs rounded-full border-0 shadow-none"
                >
                  {t("controls.modeWorkflow")}
                </GlassButton>
              </div>

              <GlassButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void handleGeneratePlan();
                }}
                aria-label={t("controls.generatePlan")}
                className="h-10 px-4 text-xs cursor-pointer"
                disabled={!canGeneratePlan}
              >
                {isPlanningWorkflow ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span>{t("controls.generatePlan")}</span>
              </GlassButton>
            </>
          ) : null}

          <GlassButton
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("input.attachment.add")}
            onClick={handleFileInputClick}
            className="min-h-[44px] min-w-[44px] cursor-pointer"
            disabled={isLoading}
          >
            <Paperclip className="w-5 h-5" />
          </GlassButton>
        </div>

        {/* HUD Controls + Send */}
        <div className="flex items-center gap-2">
          <GlassButton
            type="button"
            onClick={handleSendOrCancel}
            disabled={sendButtonDisabled}
            variant="default"
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
          </GlassButton>
        </div>
      </motion.div>

      <Input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={isLoading}
      />
          </motion.div>
        ) : (
          <motion.div
            key="controls-collapsed"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -10, scale: 0.94 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.9 }}
            transition={composerTransition}
            className="flex justify-end px-1"
          >
            <motion.button
              type="button"
              aria-label={immersiveToggleLabel}
              title={immersiveToggleLabel}
              onClick={handleImmersiveComposerToggle}
              whileHover={prefersReducedMotion ? undefined : { y: -1, scale: 1.02 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
              className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] text-slate-500 shadow-[0_14px_28px_-22px_rgba(15,23,42,0.6)] backdrop-blur-xl transition-colors hover:bg-white/88 hover:text-slate-700 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white/85"
            >
              <ChevronsUp className="h-4 w-4" />
              {hasComposerContent ? (
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(255,255,255,0.85)] dark:shadow-[0_0_0_4px_rgba(16,23,42,0.9)]" />
              ) : null}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 使用 React.memo 优化，避免不必要的重渲染
export default memo(ControlsContainer);

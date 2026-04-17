"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Download, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import { useTaskAgents } from "./use-task-agents"
import { AgentStatsBar } from "./agent-stats-bar"
import { AgentListSidebar } from "./agent-list-sidebar"
import { AgentWorkspaceHeader } from "./agent-workspace-header"
import { AgentDialogs } from "./agent-dialogs"
import { TaskAgentsSkeleton, TaskAgentsUnsupported } from "./task-agents-skeleton"
import { ChatTaskAgentEditor } from "./chat-task-agent-editor"
import { ImageTaskAgentEditor } from "./image-task-agent-editor"
import { VoiceTaskAgentEditor } from "./voice-task-agent-editor"
import { TaskAgentPreviewPanel } from "./task-agent-preview-panel"
import { TaskAgentTypeStarter } from "./task-agent-type-starter"
import { TaskAgentImportDialog } from "./task-agent-import-dialog"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function TaskAgentsClient() {
  const t = useTranslations("task-agents") as unknown as Translation
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  
  const {
    // Platform
    desktopSupport,
    isDesktop,

    // Data
    agentsLoading,
    agentsError,
    bindingCatalog,
    bindingsLoading,
    localAssets,
    assetsLoading,
    modelGroups,
    isLoadingModels,

    // Selection
    selectedAgentId,
    selectedAgent,
    isStarterState,
    isImageWorkspace,
    isVoiceWorkspace,
    showBindingsWorkspace,

    // Draft
    draft,
    previewDraft,
    draftPayload,
    parsedImageExtraParams,
    parsedVoiceExtraParams,
    saveDisabled,

    // Model select
    taskAgentModelSelectValue,
    selectedTaskAgentModelOption,
    unknownTaskAgentModelLabel,

    // Filters
    searchQuery,
    kindFilter,
    statusFilter,
    toolQuery,
    skillQuery,
    showSelectedToolsOnly,
    showSelectedSkillsOnly,
    filteredAgents,
    groupedAgents,
    filteredBindingTools,
    filteredBindingSkills,

    // Computed
    stats,
    dateFormatter,

    // Operation state
    isSaving,
    isPreviewing,
    isReindexing,
    isImportPreviewing,
    isImporting,
    deleteDialogOpen,
    discardDialogOpen,
    previewResult,
    previewError,
    claudeImportPreview,
    claudeImportError,

    // Actions
    setSearchQuery,
    setKindFilter,
    setStatusFilter,
    setToolQuery,
    setSkillQuery,
    setShowSelectedToolsOnly,
    setShowSelectedSkillsOnly,
    setDeleteDialogOpen,
    setPreviewDraft,
    updateDraft,
    updateImageDraft,
    updateVoiceDraft,
    handleSelectAgent,
    handleSelectNewAgentType,
    handleTaskAgentModelChange,
    toggleBinding,
    handleSave,
    handleDelete,
    handleReindex,
    handleRunPreview,
    handlePreviewClaudeImport,
    handleImportClaudeAgents,
    handleDiscardConfirm,
    handleDiscardCancel,
    handleCreateNew,
  } = useTaskAgents(t)

  if (desktopSupport === null) {
    return <TaskAgentsSkeleton t={t} />
  }

  if (!isDesktop) {
    return <TaskAgentsUnsupported t={t} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={BotIcon}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
              className="h-8 rounded-lg border-white/8 text-[12px]"
            >
              <Download className="mr-1.5 size-3.5" />
              {t("actions.importClaude")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReindex}
              disabled={isReindexing}
              className="h-8 rounded-lg border-white/8 text-[12px]"
            >
              <RefreshCw
                className={cn("mr-1.5 size-3.5", isReindexing && "animate-spin")}
              />
              {isReindexing ? t("actions.reindexing") : t("actions.reindex")}
            </Button>
          </div>
        }
      />

      <AgentStatsBar stats={stats} t={t} />

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <AgentListSidebar
          t={t}
          searchQuery={searchQuery}
          kindFilter={kindFilter}
          statusFilter={statusFilter}
          selectedAgentId={selectedAgentId}
          isStarterState={isStarterState}
          agentsLoading={agentsLoading}
          agentsError={agentsError}
          filteredAgents={filteredAgents}
          groupedAgents={groupedAgents}
          dateFormatter={dateFormatter}
          onSearchChange={setSearchQuery}
          onKindFilterChange={setKindFilter}
          onStatusFilterChange={setStatusFilter}
          onSelectAgent={handleSelectAgent}
        />

        <GlassCard hover="none" className="overflow-hidden border-white/6">
          <AgentWorkspaceHeader
            t={t}
            selectedAgent={selectedAgent}
            isStarterState={isStarterState}
            isImageWorkspace={isImageWorkspace}
            isVoiceWorkspace={isVoiceWorkspace}
            isSaving={isSaving}
            saveDisabled={saveDisabled}
            dateFormatter={dateFormatter}
            onDelete={() => setDeleteDialogOpen(true)}
            onSave={handleSave}
            onBackToStarter={handleCreateNew}
          />

          <GlassCardContent className="pt-4">
            {isStarterState ? (
              <TaskAgentTypeStarter t={t} onSelect={handleSelectNewAgentType} />
            ) : (
              <Tabs defaultValue="config" className="space-y-4">
                <TabsList
                  className={cn(
                    "grid w-full bg-white/4 p-1",
                    showBindingsWorkspace ? "grid-cols-4" : "grid-cols-3",
                  )}
                >
                  <TabsTrigger value="config" className="text-[12px]">{t("tabs.config")}</TabsTrigger>
                  {showBindingsWorkspace && (
                    <TabsTrigger value="bindings" className="text-[12px]">{t("tabs.bindings")}</TabsTrigger>
                  )}
                  <TabsTrigger value="preview" className="text-[12px]">{t("tabs.preview")}</TabsTrigger>
                  <TabsTrigger value="debug" className="text-[12px]">{t("tabs.debug")}</TabsTrigger>
                </TabsList>

                {isImageWorkspace ? (
                  <ImageTaskAgentEditor
                    t={t}
                    draft={draft}
                    previewDraft={previewDraft}
                    draftPayload={draftPayload}
                    parsedImageExtraParamsError={parsedImageExtraParams.error}
                    taskAgentModelSelectValue={taskAgentModelSelectValue}
                    selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                    unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                    isLoadingModels={isLoadingModels}
                    modelGroups={modelGroups}
                    updateDraft={updateDraft}
                    updateImageDraft={updateImageDraft}
                    handleTaskAgentModelChange={handleTaskAgentModelChange}
                  />
                ) : isVoiceWorkspace ? (
                  <VoiceTaskAgentEditor
                    t={t}
                    draft={draft}
                    parsedVoiceExtraParamsError={parsedVoiceExtraParams.error}
                    taskAgentModelSelectValue={taskAgentModelSelectValue}
                    selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                    unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                    isLoadingModels={isLoadingModels}
                    modelGroups={modelGroups}
                    updateDraft={updateDraft}
                    updateVoiceDraft={updateVoiceDraft}
                    handleTaskAgentModelChange={handleTaskAgentModelChange}
                  />
                ) : (
                  <ChatTaskAgentEditor
                    t={t}
                    draft={draft}
                    previewDraft={previewDraft}
                    draftPayload={draftPayload}
                    taskAgentModelSelectValue={taskAgentModelSelectValue}
                    selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                    unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                    isLoadingModels={isLoadingModels}
                    modelGroups={modelGroups}
                    bindingCatalog={bindingCatalog}
                    bindingsLoading={bindingsLoading}
                    localAssets={localAssets}
                    assetsLoading={assetsLoading}
                    filteredBindingTools={filteredBindingTools}
                    filteredBindingSkills={filteredBindingSkills}
                    toolQuery={toolQuery}
                    skillQuery={skillQuery}
                    showSelectedToolsOnly={showSelectedToolsOnly}
                    showSelectedSkillsOnly={showSelectedSkillsOnly}
                    updateDraft={updateDraft}
                    handleTaskAgentModelChange={handleTaskAgentModelChange}
                    setToolQuery={setToolQuery}
                    setSkillQuery={setSkillQuery}
                    setShowSelectedToolsOnly={setShowSelectedToolsOnly}
                    setShowSelectedSkillsOnly={setShowSelectedSkillsOnly}
                    toggleBinding={toggleBinding}
                  />
                )}

                <TaskAgentPreviewPanel
                  t={t}
                  selectedAgent={selectedAgent}
                  previewDraft={previewDraft}
                  previewResult={previewResult}
                  previewError={previewError}
                  isPreviewing={isPreviewing}
                  setPreviewDraft={setPreviewDraft}
                  handleRunPreview={handleRunPreview}
                />
              </Tabs>
            )}
          </GlassCardContent>
        </GlassCard>
      </div>

      <AgentDialogs
        t={t}
        deleteDialogOpen={deleteDialogOpen}
        discardDialogOpen={discardDialogOpen}
        selectedAgentName={selectedAgent?.name ?? ""}
        onDeleteOpenChange={setDeleteDialogOpen}
        onDeleteConfirm={handleDelete}
        onDiscardConfirm={handleDiscardConfirm}
        onDiscardCancel={handleDiscardCancel}
      />
      <TaskAgentImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        t={t}
        isPreviewing={isImportPreviewing}
        isImporting={isImporting}
        preview={claudeImportPreview}
        error={claudeImportError}
        onPreview={handlePreviewClaudeImport}
        onImport={handleImportClaudeAgents}
      />
    </div>
  )
}

function BotIcon(props: React.ComponentProps<typeof Bot>) {
  return <Bot {...props} />
}

const Bot = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
)

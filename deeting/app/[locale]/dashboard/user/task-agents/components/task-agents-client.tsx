"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Download, RefreshCw, Plus, Search, Layers, Terminal, MessageSquare, BrainCircuit, X, Activity } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { Badge } from "@/components/ui/shadcn/badge"
import { Input } from "@/components/ui/shadcn/input"
import { cn } from "@/lib/utils"

import { Tabs } from "@/components/ui/shadcn/tabs"
import { useTaskAgents } from "./use-task-agents"
import { AgentListSidebar } from "./agent-list-sidebar"
import { TaskAgentsSkeleton, TaskAgentsUnsupported } from "./task-agents-skeleton"
import { ChatTaskAgentEditor } from "./chat-task-agent-editor"
import { ImageTaskAgentEditor } from "./image-task-agent-editor"
import { VoiceTaskAgentEditor } from "./voice-task-agent-editor"
import { TaskAgentPreviewPanel } from "./task-agent-preview-panel"
import { TaskAgentTypeStarter } from "./task-agent-type-starter"
import { TaskAgentImportDialog } from "./task-agent-import-dialog"
import { AgentDialogs } from "./agent-dialogs"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function TaskAgentsClient() {
  const t = useTranslations("task-agents") as unknown as Translation
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = React.useState<"config" | "bindings" | "preview" | "debug">("config")
  const [inspectorOpen, setInspectorOpen] = React.useState(false)

  const {
    desktopSupport,
    isDesktop,
    agentsLoading,
    agentsError,
    bindingCatalog,
    bindingsLoading,
    localAssets,
    assetsLoading,
    modelGroups,
    isLoadingModels,
    selectedAgentId,
    selectedAgent,
    isStarterState,
    isImageWorkspace,
    isVoiceWorkspace,
    showBindingsWorkspace,
    draft,
    previewDraft,
    draftPayload,
    parsedImageExtraParams,
    parsedVoiceExtraParams,
    saveDisabled,
    taskAgentModelSelectValue,
    selectedTaskAgentModelOption,
    unknownTaskAgentModelLabel,
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
    stats,
    dateFormatter,
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

  if (desktopSupport === null) return <TaskAgentsSkeleton t={t} />
  if (!isDesktop) return <TaskAgentsUnsupported t={t} />

  return (
    <div className="flex flex-col bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100dvh-var(--desktop-title-bar-height,0px)-var(--shell-toolbar-h))]">
      {/* Workstation Header */}
      <header className="flex h-[56px] flex-none items-center justify-between px-6 border-b border-[var(--hairline)] bg-[var(--window-bg)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <BrainCircuit className="size-4.5" />
            </div>
            <h1 className="ws-view-title">{t("title")}</h1>
          </div>
          <div className="h-4 w-px bg-[var(--hairline-strong)]" />
          <div className="flex items-center gap-2">
             <Badge variant="secondary" className="ws-num text-[10px] px-2 py-0 h-5 bg-[var(--panel-bg-inset)] border-[var(--hairline)] text-[var(--ink-3)] font-medium">
                {stats.totalCount} AGENTS
             </Badge>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleReindex}
            disabled={isReindexing}
            className="ws-control flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)] rounded-lg transition-all"
          >
            <RefreshCw className={cn("size-3.5", isReindexing && "animate-spin")} />
            {isReindexing ? "REINDEXING..." : "REINDEX"}
          </button>
          
          <div className="w-px h-4 bg-[var(--hairline)]" />
          
          <Button
            type="button"
            variant="ios-primary"
            size="sm"
            onClick={handleCreateNew}
            className="h-8 gap-2 rounded-full px-4 text-[11px] font-semibold font-[var(--font-text)] leading-none tracking-[0.1px]"
          >
            <Plus className="size-3.5" />
            {t("actions.new")}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Agent Library Navigator */}
        <aside className="w-[280px] flex-none border-r border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 flex flex-col overflow-hidden">
          <div className="flex-none px-4 py-4 space-y-4">
            <div className="flex items-center justify-between px-1">
               <p className="ws-meta uppercase tracking-widest text-[9px] opacity-60">Library</p>
               <button onClick={() => setImportDialogOpen(true)} className="ws-control text-[9px] font-bold text-[var(--accent-strong)] hover:underline flex items-center gap-1">
                  <Download className="size-2.5" />
                  IMPORT
               </button>
            </div>
            
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)] group-focus-within:text-[var(--accent-strong)] transition-colors" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("library.searchPlaceholder")}
                className="ws-control h-9 border-[var(--hairline)] bg-[var(--panel-bg)]/80 pl-9 text-xs rounded-xl focus:ring-1 focus:ring-[var(--accent-soft)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-4)] hover:text-[var(--danger)]">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar">
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
          </div>

        
        </aside>

        {/* Central Workspace: Terminal Editor */}
        <main className="flex-1 flex flex-col min-w-0 bg-[var(--window-bg)] overflow-hidden relative">
          <Tabs value={activeWorkspaceTab} onValueChange={(v) => setActiveWorkspaceTab(v as any)} className="flex-1 flex flex-col min-h-0">
            {isStarterState ? (
              <div className="flex-1 overflow-y-auto p-12 flex items-center justify-center bg-[var(--panel-bg-inset)]/20">
                <div className="max-w-3xl w-full">
                  <TaskAgentTypeStarter t={t} onSelect={handleSelectNewAgentType} />
                </div>
              </div>
            ) : (
              <>
                {/* Workspace Tabs Header */}
                <div className="flex h-[48px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 backdrop-blur-md px-6">
                  <nav className="flex items-center gap-1">
                    {[
                      { id: "config", label: t("tabs.config"), icon: Terminal },
                      ...(showBindingsWorkspace ? [{ id: "bindings", label: t("tabs.bindings"), icon: Layers }] : []),
                      { id: "preview", label: t("tabs.preview"), icon: MessageSquare },
                    ].map((tab) => {
                      const active = activeWorkspaceTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveWorkspaceTab(tab.id as any)}
                          className={cn(
                            "ws-control flex h-8 items-center gap-2 rounded-lg px-3 transition-all",
                            active
                              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold"
                              : "text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink-2)]"
                          )}
                        >
                          <tab.icon className="size-3.5" />
                          <span className="text-[11px] uppercase tracking-wide">{tab.label}</span>
                        </button>
                      )
                    })}
                  </nav>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setInspectorOpen((v) => !v)}
                      aria-pressed={inspectorOpen}
                      className={cn(
                        "ws-control flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] uppercase tracking-wider transition-all",
                        inspectorOpen
                          ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold"
                          : "font-medium text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink-2)]",
                      )}
                      title="Toggle inspector"
                    >
                      <Activity className="size-3.5" />
                      <span>Inspector</span>
                    </button>
                    <div className="h-4 w-px bg-[var(--hairline-strong)]" />
                    <button
                      onClick={handleSave}
                      disabled={saveDisabled || isSaving}
                      className="ws-control h-8 px-5 rounded-lg bg-[var(--accent-strong)] text-[var(--accent-contrast)] font-semibold text-[11px] hover:brightness-110 active:scale-[0.98] disabled:bg-[var(--panel-bg-inset)] disabled:text-[var(--ink-4)] disabled:cursor-not-allowed disabled:pointer-events-none transition-all flex items-center gap-2"
                    >
                      {isSaving && <RefreshCw className="size-3 animate-spin" />}
                      {t("actions.save").toUpperCase()}
                    </button>
                  </div>
                </div>

                {/* Editor Surface */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[var(--panel-bg-inset)]/40">
                  <div className="max-w-[960px] mx-auto space-y-8">
                    {/* Revision eyebrow — editorial masthead strip */}
                    {selectedAgent ? (
                      <div className="flex items-center gap-2 text-[var(--ink-4)]">
                        <span className="font-mono text-[10px] font-bold tabular-nums tracking-[0.16em]">
                          REV-{agentVersion(selectedAgent)}
                        </span>
                        <span className="size-[3px] rounded-full bg-current opacity-60" />
                        <span className="text-[9px] font-semibold uppercase tracking-[0.22em]">
                          Last Sync
                        </span>
                        <span className="font-mono text-[10px] font-medium tabular-nums tracking-tight text-[var(--ink-3)]">
                          {dateFormatter.format(new Date(selectedAgent.updated_at))}
                        </span>
                        <div className="ml-auto h-px flex-1 bg-[var(--hairline-subtle)]" />
                      </div>
                    ) : null}

                    {/* Dynamic Viewport */}
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {activeWorkspaceTab === "config" && (
                          <div className="space-y-12">
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
                          </div>
                      )}
                      
                      {activeWorkspaceTab === "bindings" && showBindingsWorkspace && (
                          <div className="p-12 border-2 border-dashed border-[var(--hairline)] rounded-3xl text-center bg-[var(--panel-bg-inset)]/20">
                              <Layers className="size-12 mx-auto mb-4 text-[var(--ink-4)] opacity-30" />
                              <h4 className="ws-pane-title text-[14px] text-[var(--ink-3)] mb-1">Binding Console</h4>
                              <p className="ws-body text-xs opacity-40">Manage tool-to-model neuro-connections.</p>
                          </div>
                      )}

                      {activeWorkspaceTab === "preview" && (
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
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Tabs>
        </main>

        {/* Diagnostic Inspector Sidebar (toggleable) */}
        {inspectorOpen && (
          <aside className="w-[300px] flex-none border-l border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 p-6 overflow-y-auto animate-in slide-in-from-right-4 fade-in duration-200">
             <div className="flex items-center justify-between mb-6">
                <h3 className="ws-meta text-[10px] font-bold uppercase tracking-widest opacity-60 flex items-center gap-2">
                   <Activity className="size-3 text-[var(--accent-strong)]" />
                   Inspector
                </h3>
                <button
                  onClick={() => setInspectorOpen(false)}
                  className="flex size-6 items-center justify-center rounded-md text-[var(--ink-4)] hover:bg-[var(--panel-bg-inset)]/60 hover:text-[var(--ink-2)] transition"
                  aria-label="Close inspector"
                >
                  <X className="size-3.5" />
                </button>
             </div>

             <div className="space-y-8">
              <div>
                 <h4 className="ws-meta text-[10px] font-bold uppercase tracking-widest opacity-60 mb-3">
                    Intelligence Metrics
                 </h4>
                 <div className="ws-bezel rounded-2xl overflow-hidden bg-[var(--panel-bg)]/50">
                    <div className="ws-bezel-inner p-4 space-y-4">
                       <div className="flex justify-between items-center">
                          <span className="ws-body text-[11px] font-medium opacity-60">Success Rate</span>
                          <span className="ws-num text-[11px] font-bold text-[var(--ok)]">98.4%</span>
                       </div>
                       <div className="flex justify-between items-center">
                          <span className="ws-body text-[11px] font-medium opacity-60">Avg. Latency</span>
                          <span className="ws-num text-[11px] font-bold">2.4s</span>
                       </div>
                       <div className="flex justify-between items-center">
                          <span className="ws-body text-[11px] font-medium opacity-60">Resource Load</span>
                          <div className="w-16 h-1.5 bg-[var(--panel-bg-inset)] rounded-full overflow-hidden">
                             <div className="h-full bg-[var(--accent-strong)] w-[65%]" />
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              <div>
                 <h4 className="ws-meta text-[10px] font-bold uppercase tracking-widest opacity-60 mb-3">Neuro-Registry</h4>
                 <div className="space-y-2">
                    {[
                      { label: "Tokenization", status: "Active" },
                      { label: "Vector Search", status: "Enabled" },
                      { label: "Function Call", status: "Optimized" }
                    ].map(item => (
                       <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--panel-bg-inset)]/40 border border-[var(--hairline)]">
                          <span className="ws-body text-[10px] font-semibold">{item.label}</span>
                          <span className="ws-meta text-[8px] font-bold text-[var(--accent-strong)]">{item.status}</span>
                       </div>
                    ))}
                 </div>
              </div>
             </div>
          </aside>
        )}
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

function agentVersion(agent: any) {
  if (!agent) return "001";
  return String(agent.version || "1").padStart(3, '0');
}


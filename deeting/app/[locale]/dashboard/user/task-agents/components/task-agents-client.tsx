"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { RefreshCw, Plus, Search, X, Activity } from "lucide-react"

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
type WorkspaceTab = "config" | "bindings" | "preview" | "debug"

export function TaskAgentsClient() {
  const t = useTranslations("task-agents") as unknown as Translation
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    React.useState<WorkspaceTab>("config")
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
    isExternalScanning,
    isExternalImporting,
    deleteDialogOpen,
    discardDialogOpen,
    previewResult,
    previewError,
    claudeImportPreview,
    claudeImportError,
    externalAgentPreview,
    externalAgentError,
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
    handleScanExternalAgents,
    handleImportExternalAgents,
    handleDiscardConfirm,
    handleDiscardCancel,
    handleCreateNew,
  } = useTaskAgents(t)

  if (desktopSupport === null) return <TaskAgentsSkeleton t={t} />
  if (!isDesktop) return <TaskAgentsUnsupported t={t} />

  return (
    <div className="flex min-h-0 min-w-0 bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100dvh-var(--desktop-title-bar-height,0px)-var(--shell-toolbar-h))] select-none">
      {/* 
          LEFT COLUMN: THE INDEX 
          Rational, borderless typographic navigation
      */}
      <aside className="flex min-h-0 w-[380px] flex-none flex-col overflow-hidden px-12 pt-16 pb-8">
        <header className="flex-none mb-16 space-y-2">
          <h1 className="text-4xl font-bold tracking-tighter text-[var(--ink)] uppercase">
            {t("title").split('').map((char, i) => (
              <span key={i} className="inline-block hover:translate-y-[-2px] transition-transform duration-300 cursor-default">{char}</span>
            ))}
          </h1>
          <div className="flex items-center gap-4">
             <span className="font-mono text-[10px] tracking-[0.3em] text-[var(--ink-4)] uppercase">
                {t("workspace.coreRegistry", { count: stats.totalCount })}
             </span>
             <div className="h-px flex-1 bg-[var(--hairline-strong)] opacity-30" />
          </div>
        </header>

        <div className="flex-none mb-12 space-y-8">
          <div className="relative group">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("library.searchPlaceholder").toUpperCase()}
              className="w-full bg-transparent border-b border-[var(--hairline-strong)] py-2 text-[11px] font-bold tracking-widest text-[var(--ink)] placeholder:text-[var(--ink-4)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors uppercase"
            />
            <Search className="absolute right-0 top-1/2 -translate-y-1/2 size-3 text-[var(--ink-4)] opacity-50" />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
             {[
               { value: "all", label: t("filters.allKinds") },
               { value: "chat", label: t("badges.chat") },
               { value: "image", label: t("badges.imageGeneration") },
               { value: "voice", label: t("badges.textToSpeech") },
             ].map(opt => (
               <button
                 key={opt.value}
                 onClick={() => setKindFilter(opt.value)}
                 className={cn(
                   "text-[9px] font-bold tracking-[0.2em] uppercase transition-colors",
                   kindFilter === opt.value ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)] hover:text-[var(--ink-3)]"
                 )}
               >
                 {opt.label}
               </button>
             ))}
          </div>

          <div className="flex items-center justify-between">
            <button 
              onClick={handleCreateNew}
              className="group flex items-center gap-3 text-[11px] font-bold tracking-widest text-[var(--accent-strong)] hover:text-[var(--ink)] transition-colors"
            >
              <div className="size-5 flex items-center justify-center rounded-full border border-current group-hover:bg-current group-hover:text-white transition-all">
                <Plus className="size-3" />
              </div>
              {t("actions.new").toUpperCase()}
            </button>

            <button 
              onClick={() => setImportDialogOpen(true)}
              className="text-[10px] font-bold tracking-widest text-[var(--ink-3)] hover:text-[var(--accent-strong)] transition-colors uppercase"
            >
              {t("library.import")}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 mask-linear-b">
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
            setDeleteDialogOpen={setDeleteDialogOpen}
          />
        </div>

        <footer className="flex-none pt-8 flex items-center justify-between">
           <button 
              onClick={handleReindex}
              disabled={isReindexing}
              className="group flex items-center gap-2 text-[9px] font-bold tracking-[0.2em] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors"
            >
              <RefreshCw className={cn("size-2.5 transition-transform duration-700", isReindexing && "animate-spin")} />
              {(isReindexing ? t("actions.reindexing") : t("actions.reindex")).toUpperCase()}
            </button>
            <span className="font-mono text-[9px] text-[var(--ink-5)] tabular-nums">{t("workspace.copyright", { year: 2026 })}</span>
        </footer>
      </aside>

      {/* 
          RIGHT COLUMN: THE CANVAS
          Extreme whitespace, massive type, no panels
      */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--hairline)] bg-[var(--window-bg)]">
        <Tabs
          value={activeWorkspaceTab}
          onValueChange={(value) =>
            setActiveWorkspaceTab(value as WorkspaceTab)
          }
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {isStarterState ? (
            <div className="custom-scrollbar mask-linear-b flex-1 min-h-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-24 animate-in fade-in zoom-in-95 duration-1000">
                <div className="max-w-xl w-full">
                  <TaskAgentTypeStarter t={t} onSelect={handleSelectNewAgentType} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* Massive Header Section */}
              <div className="flex-none pt-20 pb-12 px-20 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] font-bold tracking-[0.2em] text-[var(--accent-strong)] opacity-80 uppercase">
                        {selectedAgent?.kind || t("workspace.defaultKind")}
                      </span>
                      <div className="h-px w-8 bg-[var(--accent-strong)] opacity-30" />
                      <span className="font-mono text-[10px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">
                        REV-{agentVersion(selectedAgent)}
                      </span>
                    </div>
                    <input
                      value={draft.name}
                      onChange={(e) => updateDraft("name", e.target.value)}
                      placeholder={t("editor.placeholders.name")}
                      className="w-full bg-transparent border-none p-0 text-6xl font-bold tracking-tight text-[var(--ink)] placeholder:opacity-10 focus:outline-none focus:ring-0 transition-all duration-500"
                    />
                  </div>

                  <div className="flex items-center gap-4 pt-4">
                    <button
                      onClick={() => setInspectorOpen((v) => !v)}
                      className={cn(
                        "group flex flex-col items-end gap-1 transition-all",
                        inspectorOpen ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)] hover:text-[var(--ink)]"
                      )}
                    >
                      <Activity className="size-4" />
                      <span className="text-[8px] font-bold tracking-[0.3em] uppercase opacity-60 group-hover:opacity-100 transition-opacity">{t("workspace.diagnostic")}</span>
                    </button>
                    
                    <div className="w-px h-8 bg-[var(--hairline)] mx-2" />

                    <button
                      onClick={handleSave}
                      disabled={saveDisabled || isSaving}
                      className="h-12 px-10 bg-[var(--ink)] text-[var(--window-bg)] font-bold text-[11px] tracking-[0.2em] uppercase hover:bg-[var(--accent-strong)] disabled:opacity-20 disabled:grayscale transition-all active:scale-[0.98]"
                    >
                      {(isSaving ? t("actions.saving") : t("actions.save")).toUpperCase()}
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center gap-8 border-b border-[var(--hairline)] pb-8">
                  <nav className="flex items-center gap-10">
                    {[
                      { id: "config", label: t("tabs.config") },
                      ...(showBindingsWorkspace ? [{ id: "bindings", label: t("tabs.bindings") }] : []),
                      { id: "preview", label: t("tabs.preview") },
                    ].map((tab) => {
                      const active = activeWorkspaceTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                            onClick={() =>
                              setActiveWorkspaceTab(tab.id as WorkspaceTab)
                            }
                          className={cn(
                            "relative pb-2 text-[10px] font-bold tracking-[0.25em] uppercase transition-all",
                            active ? "text-[var(--ink)]" : "text-[var(--ink-4)] hover:text-[var(--ink-2)]"
                          )}
                        >
                          {tab.label}
                          {active && (
                            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[var(--accent-strong)] animate-in slide-in-from-left-2 duration-300" />
                          )}
                        </button>
                      )
                    })}
                  </nav>
                </div>
              </div>

              {/* Content Area */}
              <div className="custom-scrollbar mask-linear-b flex-1 min-h-0 overflow-y-auto px-20 pb-32">
                <div className="max-w-[800px] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
                  {isImageWorkspace ? (
                    activeWorkspaceTab === "config" ? (
                      <ImageTaskAgentEditor
                        t={t}
                        draft={draft}
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
                    ) : null
                  ) : isVoiceWorkspace ? (
                    activeWorkspaceTab === "config" ? (
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
                    ) : null
                  ) : (
                    <ChatTaskAgentEditor
                      t={t}
                      activeTab={activeWorkspaceTab}
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

                  {activeWorkspaceTab === "preview" && (
                    <div className="py-8">
                      <TaskAgentPreviewPanel
                        t={t}
                        selectedAgent={selectedAgent}
                        draft={draft}
                        previewDraft={previewDraft}
                        previewResult={previewResult}
                        previewError={previewError}
                        isPreviewing={isPreviewing}
                        setPreviewDraft={setPreviewDraft}
                        handleRunPreview={handleRunPreview}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Tabs>

        {/* Floating Inspector (Diagnostic) */}
        {inspectorOpen && (
          <div className="absolute top-20 right-10 w-[320px] bg-[var(--window-bg)] border border-[var(--hairline-strong)] p-8 shadow-2xl animate-in fade-in slide-in-from-right-8 duration-500 z-50">
             <div className="flex items-center justify-between mb-10">
                <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent-strong)]">
                   {t("workspace.inspector.title")}
                </h3>
                <button
                  onClick={() => setInspectorOpen(false)}
                  className="text-[var(--ink-4)] hover:text-[var(--ink)]"
                >
                  <X className="size-4" />
                </button>
             </div>

             <div className="space-y-12">
              <section className="space-y-4">
                 <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--ink-4)] border-b border-[var(--hairline)] pb-2">
                    {t("workspace.inspector.efficiencyTitle")}
                 </h4>
                 <div className="space-y-6">
                    <div className="flex justify-between items-end">
                       <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{t("workspace.inspector.precision")}</span>
                       <span className="font-mono text-2xl font-bold text-[var(--ok)] tracking-tighter">98.4</span>
                    </div>
                    <div className="flex justify-between items-end">
                       <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{t("workspace.inspector.latency")}</span>
                       <span className="font-mono text-2xl font-bold tracking-tighter">2.4<span className="text-xs ml-1 opacity-40">{t("workspace.inspector.ms")}</span></span>
                    </div>
                    <div className="space-y-2">
                       <div className="flex justify-between text-[9px] font-bold tracking-widest text-[var(--ink-4)] uppercase">
                         <span>{t("workspace.inspector.loadDistribution")}</span>
                         <span>65%</span>
                       </div>
                       <div className="w-full h-[1px] bg-[var(--hairline-strong)]">
                          <div className="h-full bg-[var(--ink)] w-[65%] transition-all duration-1000" />
                       </div>
                    </div>
                 </div>
              </section>

              <section className="space-y-4">
                 <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--ink-4)] border-b border-[var(--hairline)] pb-2">
                    {t("workspace.inspector.registryHooks")}
                 </h4>
                 <div className="space-y-1">
                    {[
                      { label: t("workspace.inspector.hooks.tokenization"), status: t("workspace.inspector.status.stable") },
                      { label: t("workspace.inspector.hooks.vectorIndex"), status: t("workspace.inspector.status.synced") },
                      { label: t("workspace.inspector.hooks.functionCall"), status: t("workspace.inspector.status.optimized") }
                    ].map(item => (
                       <div key={item.label} className="flex items-center justify-between py-2 group">
                          <span className="text-[10px] font-bold tracking-widest text-[var(--ink-3)] group-hover:text-[var(--ink)] transition-colors">{item.label.toUpperCase()}</span>
                          <span className="font-mono text-[9px] font-bold text-[var(--accent-strong)] opacity-60">{item.status}</span>
                       </div>
                    ))}
                 </div>
              </section>
             </div>
          </div>
        )}
      </main>

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
        isExternalScanning={isExternalScanning}
        isExternalImporting={isExternalImporting}
        preview={claudeImportPreview}
        externalPreview={externalAgentPreview}
        error={claudeImportError}
        externalError={externalAgentError}
        onPreview={handlePreviewClaudeImport}
        onImport={handleImportClaudeAgents}
        onExternalScan={handleScanExternalAgents}
        onExternalImport={handleImportExternalAgents}
      />
    </div>
  )
}

function agentVersion(agent: { version?: string | number } | null | undefined) {
  if (!agent) return "001";
  return String(agent.version || "1").padStart(3, '0');
}


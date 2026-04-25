"use client"
import React, { useState, useEffect, useRef } from "react"
import { useUserSecretary, useUserEmbeddingConfig } from "@/lib/swr/use-embedding-settings"
import { usePlatformModels } from "@/lib/swr/use-platform-models"
import { useChatModels } from "@/hooks/use-chat-models"
import { isTauriRuntime } from "@/lib/runtime/tauri"

export function TerminalDashboard() {
  const { data: secretaryData } = useUserSecretary()
  const { data: embeddingData } = useUserEmbeddingConfig()
  const { models: platformModels } = usePlatformModels()
  const { models: chatModels } = useChatModels({ enabled: isTauriRuntime() })

  const secModelId = secretaryData?.provider_model_id || secretaryData?.model_name
  // Try local chat models first (desktop), then platform models
  const localSecModel = isTauriRuntime()
    ? chatModels.find((m) => m.provider_model_id === secModelId || m.id === secModelId)
    : undefined
  const platformSecModel = platformModels.find((m) => m.model_id === secModelId || m.id === secModelId)
  const secretaryModelName =
    localSecModel?.display_name || localSecModel?.id || platformSecModel?.display_name || secModelId || "Claude-3.5-Sonnet (Default)"

  const embModelId = embeddingData?.provider_model_id
  const localEmbModel = isTauriRuntime()
    ? chatModels.find((m) => m.provider_model_id === embModelId || m.id === embModelId)
    : undefined
  const platformEmbModel = platformModels.find((m) => m.model_id === embModelId || m.id === embModelId)
  const embeddingModelName =
    localEmbModel?.display_name || localEmbModel?.id || platformEmbModel?.display_name || embModelId || "text-embedding-3-large (Default)"

  const [uptime, setUptime] = useState("00:00:00")
  const [nodes, setNodes] = useState<React.ReactNode[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      const diff = Math.floor((Date.now() - start) / 1000)
      const h = String(Math.floor(diff / 3600)).padStart(2, "0")
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0")
      const s = String(diff % 60).padStart(2, "0")
      setUptime(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const addNode = (node: React.ReactNode) => {
    setNodes((prev) => [...prev, node])
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    }, 50)
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  useEffect(() => {
    let isCancelled = false

    const runScenario = async () => {
      setNodes([])

      // Initializing
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] mb-6 text-xs font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--atl-success)] shadow-[0_0_8px_var(--atl-success)] animate-pulse"></div>
          [SYSTEM] Kernel active. Awaiting instructions...
        </div>
      )
      await sleep(1000)
      if (isCancelled) return

      // Slide 1: User input
      addNode(
        <div key={Date.now()} className="mb-6 flex gap-3">
          <div className="shrink-0 mt-0.5 text-[var(--atl-accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </div>
          <div className="text-[var(--atl-ink)] text-[13px] leading-relaxed">
            Please analyze the recent marketing data, generate a summary report, and draft an email to the team.
          </div>
        </div>
      )
      await sleep(800)
      if (isCancelled) return

      // Slide 2: AI Planning
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider">
          <span className="w-4 border-t border-[var(--atl-rule)]"></span>
          Intent Parsing
          <span className="flex-1 border-t border-[var(--atl-rule)]"></span>
        </div>
      )
      await sleep(400)
      if (isCancelled) return
      
      addNode(
        <div key={Date.now()} className="text-[var(--atl-ink-soft)] font-mono text-xs pl-6 border-l border-[var(--atl-rule)] ml-1.5 mb-2">
          &gt; Analyzing intent signatures...<br/>
          <span className="text-[var(--atl-success)] mt-1 inline-block">&gt; Match: [Data Analysis, Summarization, Email Drafting]</span>
        </div>
      )
      await sleep(600)
      if (isCancelled) return

      addNode(
        <div key={Date.now()} className="pl-6 ml-1.5 mb-8 border-l border-[var(--atl-rule)]">
          <div className="p-4 border border-[var(--atl-rule)] bg-[var(--atl-canvas-soft)] rounded-lg grid grid-cols-2 gap-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-[var(--atl-accent)]"></div>
            <div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] uppercase tracking-wider mb-1">Vector Operation</div>
              <div className="text-[var(--atl-ink)] text-xs font-medium">Query Knowledge Base</div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] mt-2 font-mono truncate">{embeddingModelName}</div>
            </div>
            <div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] uppercase tracking-wider mb-1">Generative Operation</div>
              <div className="text-[var(--atl-ink)] text-xs font-medium">Draft Report & Email</div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] mt-2 font-mono truncate">{secretaryModelName}</div>
            </div>
          </div>
        </div>
      )
      await sleep(1200)
      if (isCancelled) return

      // Slide 3: Execution
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider">
          <span className="w-4 border-t border-[var(--atl-rule)]"></span>
          Execution Log
          <span className="flex-1 border-t border-[var(--atl-rule)]"></span>
        </div>
      )
      await sleep(400)
      if (isCancelled) return

      const steps = [
        'Querying vector space for "marketing data Q3"',
        'Synthesizing key metrics and trends',
        'Drafting team communication',
      ]

      for (const step of steps) {
        if (isCancelled) return
        addNode(
          <div key={Date.now() + step} className="pl-6 ml-1.5 mb-4 border-l border-[var(--atl-rule)] relative">
            <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[var(--atl-canvas)] border-2 border-[var(--atl-rule)]"></div>
            <div className="flex justify-between items-end mb-1.5">
              <div className="text-[var(--atl-ink)] text-xs font-mono">{step}</div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] font-mono">Running</div>
            </div>
            <div className="h-[3px] w-full bg-[var(--atl-rule)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-[var(--atl-accent)] animate-[progress_1s_ease-in-out_forwards]"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        )
        await sleep(1000)
      }

      await sleep(500)
      if (isCancelled) return

      // Slide 4: Completion
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider mt-8">
          <span className="w-4 border-t border-[var(--atl-rule)]"></span>
          Output Artifacts
          <span className="flex-1 border-t border-[var(--atl-rule)]"></span>
        </div>
      )
      await sleep(600)
      if (isCancelled) return

      addNode(
        <div key={Date.now()} className="pl-6 ml-1.5 mb-8">
          <div className="bg-[var(--atl-canvas)] border border-[var(--atl-rule)] rounded-lg shadow-[var(--atl-shell-shadow)] overflow-hidden transition-all duration-500 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-[var(--atl-canvas-soft)] px-4 py-2 border-b border-[var(--atl-rule)] flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--atl-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <span className="text-xs font-medium text-[var(--atl-ink)]">Draft: Q3 Marketing Update</span>
            </div>
            <div className="p-4 text-[var(--atl-ink)] text-[13px] leading-relaxed font-sans">
              Hi Team,<br/><br/>Based on the Q3 data, our engagement grew by 15% and we are seeing a strong upward trend in our core demographics. The full report is attached for review.
            </div>
          </div>
        </div>
      )

      await sleep(4000)
      if (isCancelled) return
      
      addNode(
        <div key={Date.now()} className="text-[var(--atl-ink-soft)] mt-8 text-xs font-mono flex items-center gap-2 justify-center">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          Restarting observation loop...
        </div>
      )
      await sleep(3000)
      if (!isCancelled) {
        runScenario()
      }
    }

    runScenario()

    return () => {
      isCancelled = true
    }
  }, [secretaryModelName, embeddingModelName])

  return (
    <div className="ws-bezel h-[calc(100vh-80px)] min-h-[500px] flex flex-col overflow-hidden relative" style={{ background: 'var(--atl-shell-bg)' }}>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes progress {
          0% { width: 0%; }
          100% { width: 100%; }
        }
      `}} />

      {/* Atelier Header */}
      <div className="border-b border-[var(--atl-shell-border)] px-5 py-3 flex justify-between items-center shrink-0">
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--atl-success)]"></div>
            <div className="text-[var(--atl-ink)] text-[11px] uppercase tracking-widest font-semibold font-mono">Deeting Engine</div>
          </div>
          <div className="h-3 w-px bg-[var(--atl-rule)]"></div>
          <div className="text-[var(--atl-ink-soft)] text-xs font-mono tabular-nums">{uptime}</div>
        </div>
      </div>

      {/* Status Strip */}
      <div className="flex flex-wrap gap-x-8 gap-y-4 px-5 py-3 border-b border-[var(--atl-rule)] shrink-0 bg-[var(--atl-canvas-soft)]">
        <div>
          <div className="text-[10px] uppercase text-[var(--atl-ink-soft)] tracking-wider mb-1 font-mono">Secretary Model</div>
          <div className="text-[var(--atl-ink)] text-xs font-medium truncate max-w-[200px]" title={secretaryModelName}>{secretaryModelName}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--atl-ink-soft)] tracking-wider mb-1 font-mono">Embedding Engine</div>
          <div className="text-[var(--atl-ink)] text-xs font-medium truncate max-w-[200px]" title={embeddingModelName}>{embeddingModelName}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--atl-ink-soft)] tracking-wider mb-1 font-mono">Memory Node</div>
          <div className="text-[var(--atl-success)] text-xs font-medium">Active (2.4GB)</div>
        </div>
      </div>

      {/* Atelier Canvas Body */}
      <div 
        ref={containerRef}
        className="flex-1 p-6 overflow-y-auto scroll-smooth bg-[var(--atl-canvas)] relative"
      >
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(var(--atl-grid) 1px, transparent 1px), linear-gradient(90deg, var(--atl-grid) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.5
        }}></div>

        <div className="relative z-10 max-w-3xl mx-auto">
          {nodes}
        </div>
      </div>
    </div>
  )
}

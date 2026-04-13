"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

interface WorkflowLandingProps {
  onCreateWorkflow: (goal: string, hints?: string) => Promise<void>
  initialGoal?: string
}

export function WorkflowLanding({ onCreateWorkflow, initialGoal }: WorkflowLandingProps) {
  const t = useI18n("workflow")
  const [goal, setGoal] = useState(initialGoal ?? "")
  const [hints, setHints] = useState("")
  const [hintsOpen, setHintsOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const canSubmit = goal.trim().length > 0 && !loading

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)
    try {
      await onCreateWorkflow(goal.trim(), hints.trim() || undefined)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6 md:p-8">
      <Card className="w-full max-w-2xl overflow-hidden rounded-[28px] border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] shadow-[0_28px_70px_-40px_rgba(15,23,42,0.36)] backdrop-blur-2xl">
        <CardHeader className="space-y-3 border-b border-[color:var(--ios-shell-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.52),transparent)] pb-5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/60 bg-[image:var(--ios-tint-fill)] text-white shadow-[var(--ios-button-shadow)] dark:border-white/12">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl tracking-tight">{t("landing.title")}</CardTitle>
              <CardDescription className="text-sm leading-6">{t("landing.description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5 md:p-6">
          <div className="space-y-2">
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("landing.goalPlaceholder")}
              className="min-h-[120px] max-h-[200px] resize-none rounded-[24px] border-[color:var(--ios-shell-border)] bg-background/60 px-4 py-3 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.58)] focus-visible:ring-[color:var(--ios-ring)]"
              maxLength={500}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canSubmit) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
            <div className="text-right text-xs text-muted-foreground">{goal.length}/500</div>
          </div>

          <Collapsible open={hintsOpen} onOpenChange={setHintsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ios" size="sm" className="text-xs">
                {t("landing.hintsLabel")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Textarea
                value={hints}
                onChange={(e) => setHints(e.target.value)}
                placeholder={t("landing.hintsPlaceholder")}
                className="mt-3 min-h-[88px] max-h-[140px] resize-none rounded-[22px] border-[color:var(--ios-shell-border)] bg-background/55 px-4 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] focus-visible:ring-[color:var(--ios-ring)]"
                maxLength={200}
                disabled={loading}
              />
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <CardFooter className="border-t border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)]/60 p-5 md:p-6">
          <Button
            className="w-full"
            variant="ios-primary"
            size="xl"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {loading ? t("landing.creating") : t("landing.createButton")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

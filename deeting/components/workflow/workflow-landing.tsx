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
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-lg bg-card/60 backdrop-blur-xl border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{t("landing.title")}</CardTitle>
          </div>
          <CardDescription>{t("landing.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("landing.goalPlaceholder")}
              className="min-h-[88px] max-h-[160px] resize-none bg-background/50"
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
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                {t("landing.hintsLabel")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Textarea
                value={hints}
                onChange={(e) => setHints(e.target.value)}
                placeholder={t("landing.hintsPlaceholder")}
                className="mt-2 min-h-[60px] max-h-[100px] resize-none bg-background/50"
                maxLength={200}
                disabled={loading}
              />
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            size="lg"
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

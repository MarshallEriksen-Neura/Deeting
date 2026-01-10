"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Plus, Sparkles, Shield, Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { type CreateApiKeyRequest } from "@/lib/api/api-keys"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface MintKeyDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CreateApiKeyRequest) => Promise<void>
  availableModels?: string[]
  modelsLoading?: boolean
}

type Step = "basic" | "constraints" | "security"
const STEPS: Step[] = ["basic", "constraints", "security"]

/**
 * MintKeyDrawer - 3-step form for creating new API keys
 *
 * Design features:
 * - Glassmorphism sheet sliding from right
 * - Step indicator with progress
 * - Smooth transitions between steps
 * - Form validation per step
 */
export function MintKeyDrawer({
  open,
  onOpenChange,
  onSubmit,
  availableModels = [],
  modelsLoading = false,
}: MintKeyDrawerProps) {
  const t = useTranslations("apiKeys.create")
  const router = useRouter()
  const [currentStep, setCurrentStep] = React.useState<Step>("basic")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Form state
  const [formData, setFormData] = React.useState<CreateApiKeyRequest>({
    name: "",
    expiration: "never",
    budget_limit: null,
    allowed_models: [],
    rate_limit: null,
    allowed_ips: [],
    enable_logging: false,
  })

  const currentStepIndex = STEPS.indexOf(currentStep)
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === STEPS.length - 1

  const handleNext = () => {
    if (!isLastStep) {
      setCurrentStep(STEPS[currentStepIndex + 1])
    }
  }

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStep(STEPS[currentStepIndex - 1])
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit(formData)
      // Reset form on success
      setFormData({
        name: "",
        expiration: "never",
        budget_limit: null,
        allowed_models: [],
        rate_limit: null,
        allowed_ips: [],
        enable_logging: false,
      })
      setCurrentStep("basic")
    } catch (error) {
      // 交由调用方处理错误提示，仅保证抽屉状态恢复
    } finally {
      setIsSubmitting(false)
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case "basic":
        return formData.name.trim().length > 0
      case "constraints":
        return true // Optional step
      case "security":
        return true // Optional step
      default:
        return false
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full sm:max-w-lg",
          "bg-[var(--card)]/95 backdrop-blur-2xl pointer-events-auto",
          "border-l border-white/10",
          "shadow-[0_24px_80px_-32px_rgba(15,16,22,0.55)]"
        )}
      >
        <SheetHeader className="space-y-4 pb-6 px-6">
          <SheetTitle className="text-xl font-bold flex items-center gap-2">
            <Plus className="size-5 text-[var(--primary)]" />
            {t("title")}
          </SheetTitle>
          <SheetDescription>{t("subtitle")}</SheetDescription>

          {/* Step indicator */}
          <StepIndicator currentStep={currentStep} steps={STEPS} />
        </SheetHeader>

        {/* Form content */}
        <div className="flex-1 overflow-y-auto py-4 px-6">
          {currentStep === "basic" && (
            <BasicStep
              formData={formData}
              onChange={(data) => setFormData((prev) => ({ ...prev, ...data }))}
            />
          )}
          {currentStep === "constraints" && (
            <ConstraintsStep
              formData={formData}
              onChange={(data) => setFormData((prev) => ({ ...prev, ...data }))}
              availableModels={availableModels}
              modelsLoading={modelsLoading}
              onNavigateProvider={() => router.push("/dashboard/user/provider")}
            />
          )}
          {currentStep === "security" && (
            <SecurityStep
              formData={formData}
              onChange={(data) => setFormData((prev) => ({ ...prev, ...data }))}
            />
          )}
        </div>

        {/* Footer with navigation */}
        <SheetFooter className="flex-row gap-3 pt-6 border-t border-white/10 px-6 pb-4">
          {!isFirstStep && (
            <GlassButton
              variant="ghost"
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex-1"
            >
              <ChevronLeft className="size-4" />
              {t("back")}
            </GlassButton>
          )}
          {isFirstStep && (
            <GlassButton
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              {t("cancel")}
            </GlassButton>
          )}

          {isLastStep ? (
            <GlassButton
              onClick={handleSubmit}
              disabled={!canProceed() || isSubmitting}
              loading={isSubmitting}
              className="flex-1"
            >
              <Sparkles className="size-4" />
              {t("create")}
            </GlassButton>
          ) : (
            <GlassButton
              onClick={handleNext}
              disabled={!canProceed()}
              className="flex-1"
            >
              {t("next")}
              <ChevronRight className="size-4" />
            </GlassButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function StepIndicator({
  currentStep,
  steps,
}: {
  currentStep: Step
  steps: Step[]
}) {
  const t = useTranslations("apiKeys.create.steps")
  const currentIndex = steps.indexOf(currentStep)

  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => {
        const isActive = index === currentIndex
        const isCompleted = index < currentIndex

        return (
          <React.Fragment key={step}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "size-8 rounded-full flex items-center justify-center text-sm font-medium",
                  "transition-all duration-300",
                  isActive && "bg-[var(--primary)] text-white shadow-[0_0_12px_rgba(124,109,255,0.5)]",
                  isCompleted && "bg-emerald-500 text-white",
                  !isActive && !isCompleted && "bg-[var(--foreground)]/10 text-[var(--muted)]"
                )}
              >
                {isCompleted ? <Check className="size-4" /> : index + 1}
              </div>
              <span
                className={cn(
                  "text-sm font-medium hidden sm:block",
                  isActive ? "text-[var(--foreground)]" : "text-[var(--muted)]"
                )}
              >
                {t(step)}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2",
                  "transition-colors duration-300",
                  isCompleted ? "bg-emerald-500" : "bg-[var(--foreground)]/10"
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function BasicStep({
  formData,
  onChange,
}: {
  formData: CreateApiKeyRequest
  onChange: (data: Partial<CreateApiKeyRequest>) => void
}) {
  const t = useTranslations("apiKeys.create.basic")

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          placeholder={t("namePlaceholder")}
          value={formData.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="bg-[var(--foreground)]/5 border-white/10"
        />
        <p className="text-xs text-[var(--muted)]">{t("nameHint")}</p>
      </div>

      <div className="space-y-2">
        <Label>{t("expiration")}</Label>
        <Select
          value={formData.expiration}
          onValueChange={(value) =>
            onChange({ expiration: value as CreateApiKeyRequest["expiration"] })
          }
        >
          <SelectTrigger className="bg-[var(--foreground)]/5 border-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">{t("never")}</SelectItem>
            <SelectItem value="7d">{t("days7")}</SelectItem>
            <SelectItem value="30d">{t("days30")}</SelectItem>
            <SelectItem value="90d">{t("days90")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-[var(--muted)]">{t("expirationHint")}</p>
      </div>
    </div>
  )
}

function ConstraintsStep({
  formData,
  onChange,
  availableModels,
  modelsLoading,
  onNavigateProvider,
}: {
  formData: CreateApiKeyRequest
  onChange: (data: Partial<CreateApiKeyRequest>) => void
  availableModels: string[]
  modelsLoading: boolean
  onNavigateProvider: () => void
}) {
  const t = useTranslations("apiKeys.create.constraints")

  const handleModelToggle = (model: string) => {
    const currentModels = formData.allowed_models || []
    if (currentModels.includes(model)) {
      onChange({ allowed_models: currentModels.filter((m) => m !== model) })
    } else {
      onChange({ allowed_models: [...currentModels, model] })
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h4 className="font-semibold flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--primary)]" />
          {t("title")}
        </h4>
        <p className="text-sm text-[var(--muted)]">{t("description")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="budget">{t("budgetLimit")}</Label>
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">$</span>
          <Input
            id="budget"
            type="number"
            min="0"
            step="0.01"
            placeholder={t("budgetPlaceholder")}
            value={formData.budget_limit ?? ""}
            onChange={(e) =>
              onChange({
                budget_limit: e.target.value ? parseFloat(e.target.value) : null,
              })
            }
            className="bg-[var(--foreground)]/5 border-white/10"
          />
          <span className="text-sm text-[var(--muted)]">{t("perMonth")}</span>
        </div>
        <p className="text-xs text-[var(--muted)]">{t("budgetHint")}</p>
      </div>

      <div className="space-y-2">
        <Label>{t("modelScope")}</Label>
        <p className="text-xs text-[var(--muted)]">{t("modelScopeHint")}</p>

        {modelsLoading ? (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-9 rounded-lg bg-[var(--foreground)]/5 animate-pulse" />
            ))}
          </div>
        ) : availableModels.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-white/20 bg-[var(--foreground)]/5 p-3 text-xs text-[var(--muted)]">
            <div className="flex flex-col gap-2">
              <span>{t("modelScopeEmpty")}</span>
              <GlassButton size="sm" variant="secondary" className="w-fit" onClick={onNavigateProvider}>
                {t("modelScopeCTA")}
              </GlassButton>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {availableModels.map((model) => {
              const isSelected = formData.allowed_models?.includes(model)
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => handleModelToggle(model)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm text-left",
                    "border transition-all duration-200",
                    isSelected
                      ? "bg-[var(--primary)]/20 border-[var(--primary)]/50 text-[var(--foreground)]"
                      : "bg-[var(--foreground)]/5 border-white/10 text-[var(--muted)] hover:bg-[var(--foreground)]/10"
                  )}
                >
                  {model}
                </button>
              )
            })}
          </div>
        )}

        {(!formData.allowed_models || formData.allowed_models.length === 0) && (
          <p className="text-xs text-emerald-500">{t("allModels")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="rateLimit">{t("rateLimit")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="rateLimit"
            type="number"
            min="1"
            placeholder={t("rateLimitPlaceholder")}
            value={formData.rate_limit ?? ""}
            onChange={(e) =>
              onChange({
                rate_limit: e.target.value ? parseInt(e.target.value, 10) : null,
              })
            }
            className="bg-[var(--foreground)]/5 border-white/10"
          />
          <span className="text-sm text-[var(--muted)]">{t("perMinute")}</span>
        </div>
        <p className="text-xs text-[var(--muted)]">{t("rateLimitHint")}</p>
      </div>
    </div>
  )
}

function SecurityStep({
  formData,
  onChange,
}: {
  formData: CreateApiKeyRequest
  onChange: (data: Partial<CreateApiKeyRequest>) => void
}) {
  const t = useTranslations("apiKeys.create.security")

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h4 className="font-semibold flex items-center gap-2">
          <Shield className="size-4 text-emerald-500" />
          {t("title")}
        </h4>
        <p className="text-sm text-[var(--muted)]">{t("description")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="allowedIPs">{t("allowedIPs")}</Label>
        <Input
          id="allowedIPs"
          placeholder={t("allowedIPsPlaceholder")}
          value={formData.allowed_ips?.join(", ") || ""}
          onChange={(e) =>
            onChange({
              allowed_ips: e.target.value
                ? e.target.value.split(",").map((ip) => ip.trim()).filter(Boolean)
                : [],
            })
          }
          className="bg-[var(--foreground)]/5 border-white/10"
        />
        <p className="text-xs text-[var(--muted)]">{t("allowedIPsHint")}</p>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-[var(--foreground)]/5 p-4">
        <div className="space-y-0.5">
          <Label htmlFor="logging">{t("enableLogging")}</Label>
          <p className="text-xs text-[var(--muted)]">{t("enableLoggingHint")}</p>
        </div>
        <Switch
          id="logging"
          checked={formData.enable_logging || false}
          onCheckedChange={(checked) => onChange({ enable_logging: checked })}
        />
      </div>
    </div>
  )
}

export default MintKeyDrawer

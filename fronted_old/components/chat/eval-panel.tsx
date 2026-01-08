"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { X, Loader2, CheckCircle2, Trophy } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { useEval, useSubmitRating } from "@/lib/swr/use-evals";
import { EvalChallengerCard } from "./eval-challenger-card";
import { EvalExplanation } from "./eval-explanation";
import { ErrorAlert } from "./error-alert";
import { toast } from "sonner";
import type { ReasonTag } from "@/lib/api-types";

// 动态导入评分对话框（仅在需要时加载）
const EvalRatingDialog = dynamic(
  () => import("./eval-rating-dialog").then((mod) => ({ default: mod.EvalRatingDialog })),
  { ssr: false }
);

interface EvalPanelProps {
  /**
   * 评测 ID
   */
  evalId: string;
  /**
   * 关闭面板的回调
   */
  onClose?: () => void;
}

/**
 * EvalPanel 组件
 * 显示 baseline 和 challengers
 * 实现轮询刷新（递增退避）
 * 显示评测解释
 * 提供评分入口
 * 
 * Requirements: 5.1-5.8, 6.1, 6.2
 */
export function EvalPanel({ evalId, onClose }: EvalPanelProps) {
  const { t } = useI18n();

  // 获取评测数据（自动轮询）
  const { eval: evalData, isLoading, isError, error, currentPollingInterval, isPolling } = useEval(
    evalId,
    { enablePolling: true }
  );

  // 提交评分
  const submitRating = useSubmitRating(evalId);

  // 评分对话框状态
  const [isRatingDialogOpen, setIsRatingDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 处理评分提交
  const handleSubmitRating = async (winnerRunId: string, reasonTags: ReasonTag[]) => {
    setIsSubmitting(true);
    try {
      await submitRating({ winner_run_id: winnerRunId, reason_tags: reasonTags });
      toast.success(t("chat.eval.submitted"));
      setIsRatingDialogOpen(false);
    } catch (error: any) {
      console.error("Failed to submit rating:", error);
      toast.error(error?.message || t("chat.errors.invalid_reason_tags"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 加载状态
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("chat.eval.loading")}
            </CardTitle>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>
    );
  }

  // 错误状态
  if (isError || !evalData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("chat.eval.title")}</CardTitle>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ErrorAlert error={error} />
        </CardContent>
      </Card>
    );
  }

  // 获取状态显示
  const getStatusBadge = () => {
    switch (evalData.status) {
      case "running":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("chat.eval.status_running")}
          </Badge>
        );
      case "ready":
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            {t("chat.eval.status_ready")}
          </Badge>
        );
      case "rated":
        return (
          <Badge variant="default" className="gap-1 bg-amber-500">
            <Trophy className="h-3 w-3" />
            {t("chat.eval.status_rated")}
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle>{t("chat.eval.title")}</CardTitle>
              {getStatusBadge()}
              {isPolling && (
                <span className="text-xs text-muted-foreground">
                  (轮询间隔: {currentPollingInterval / 1000}s)
                </span>
              )}
            </div>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* 评测解释 */}
          <EvalExplanation explanation={evalData.explanation} />

          <Separator />

          {/* Baseline */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("chat.eval.baseline")}
            </h3>
            <Card className="border-blue-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  Baseline Run
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Run ID: {evalData.baseline_run_id}
                </p>
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* Challengers */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("chat.eval.challengers")} ({evalData.challengers.length})
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {evalData.challengers.map((challenger) => (
                <EvalChallengerCard
                  key={challenger.run_id}
                  challenger={challenger}
                />
              ))}
            </div>
          </div>

          {/* 评分按钮 */}
          {evalData.status === "ready" && (
            <div className="flex justify-end pt-4">
              <Button onClick={() => setIsRatingDialogOpen(true)}>
                <Trophy className="mr-2 h-4 w-4" />
                {t("chat.eval.select_winner")}
              </Button>
            </div>
          )}

          {/* 已评分提示 */}
          {evalData.status === "rated" && (
            <div className="flex items-center justify-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
              <Trophy className="h-5 w-5 text-amber-600" />
              <p className="text-sm font-medium text-amber-600">
                {t("chat.eval.status_rated")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 评分对话框 */}
      <EvalRatingDialog
        open={isRatingDialogOpen}
        onOpenChange={setIsRatingDialogOpen}
        baselineRun={{
          run_id: evalData.baseline_run_id,
          requested_logical_model: "Baseline",
          output_preview: undefined,
        }}
        challengers={evalData.challengers}
        onSubmit={handleSubmitRating}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
